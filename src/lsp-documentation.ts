import DOMPurify from "dompurify";
import {documentationModel} from "./lsp-document-model";
let activeWorkers=0;
const cache=new Map<string,(string|null)[]>();let cacheBytes=0;
const tags=["p","br","hr","strong","em","del","blockquote","ul","ol","li","pre","code","table","thead","tbody","tr","th","td","h1","h2","h3","h4","h5","h6","kbd","sub","sup"];
type DocumentOptions={expanded?:boolean;title?:string;summaryFirst?:boolean;beforeOpen?:()=>void};
export async function renderDocumentation(value:unknown,legacy=false,signal?:AbortSignal,options:DocumentOptions={}):Promise<HTMLElement|null>{
 const {parts,truncated}=documentationModel(value,legacy,options.expanded);if((!parts.length&&!truncated)||signal?.aborted)return null;
 const key=JSON.stringify(parts);
 let html=cache.get(key);
 if(html){cache.delete(key);cache.set(key,html);}
 if(!html&&parts.some(p=>p.kind==="markdown")&&activeWorkers<2){
  html=await new Promise<(string|null)[]|undefined>(resolve=>{
   let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,finished=false;
   const finish=(result?:(string|null)[])=>{if(finished)return;finished=true;clearTimeout(timer);worker?.terminate();signal?.removeEventListener("abort",abort);activeWorkers--;resolve(result);};
   const abort=()=>finish();activeWorkers++;
   try{
    worker=new Worker(new URL("./lsp-document.worker.ts",import.meta.url),{type:"module"});
    signal?.addEventListener("abort",abort,{once:true});
    timer=setTimeout(()=>finish(),600);
    worker.onmessage=e=>{
     const raw=e.data?.html;
     if(!Array.isArray(raw)||raw.length!==parts.length||raw.some(h=>h!==null&&typeof h!=="string")||raw.reduce((n,h)=>n+(h?.length??0),0)>262144){finish();return;}
     finish(raw.map(h=>h===null?null:DOMPurify.sanitize(h,{ALLOWED_TAGS:tags,ALLOWED_ATTR:["start","colspan","rowspan"],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false})));
    };
    worker.onerror=()=>finish();worker.postMessage({parts});
   }catch{finish();}
  });
  if(html&&!signal?.aborted){
   const size=key.length+html.reduce((n,h)=>n+(h?.length??0),0);
   if(size<=131072&&!cache.has(key)){while(cache.size>=16||cacheBytes+size>262144){const first=cache.keys().next().value;if(first===undefined)break;const old=cache.get(first)!;cacheBytes-=first.length+old.reduce((n,h)=>n+(h?.length??0),0);cache.delete(first);}cache.set(key,html);cacheBytes+=size;}
  }
 }
 if(signal?.aborted)return null;
 const dom=document.createElement("div");dom.className="lsp-documentation";
 for(let i=0;i<parts.length;i++){
  const part=parts[i],section=document.createElement("div");section.className="lsp-document-section";
  if(part.kind==="markdown"&&html?.[i]!=null)section.innerHTML=html[i]!;
  else if(part.kind==="code"){const pre=document.createElement("pre"),code=document.createElement("code");code.textContent=part.text;pre.append(code);section.append(pre);}
  else {section.classList.add("lsp-document-plain");section.textContent=part.text;}
  if(i===0&&options.summaryFirst)section.classList.add("lsp-completion-summary");
  dom.append(section);
 }
 if(truncated){const notice=document.createElement("div");notice.className="lsp-document-limit";notice.setAttribute("role","note");notice.textContent=options.expanded?"文档超出显示上限，当前内容不完整":"预览仅显示部分内容";dom.append(notice);}
 if(!options.expanded){
  const expand=document.createElement("button");expand.type="button";expand.className="lsp-document-expand";expand.setAttribute("aria-label","展开文档");expand.title="展开文档";
  expand.append(expandIcon());expand.addEventListener("mousedown",event=>event.preventDefault());
  expand.addEventListener("click",()=>{options.beforeOpen?.();void openDocumentationReader(value,legacy,signal,options);});dom.prepend(expand);
 }
 return dom;
}
let closeReader:(()=>void)|undefined;
function expandIcon(pathData="M10 2h4v4M14 2 9 7M6 14H2v-4M2 14l5-5"){
 const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 16 16");svg.setAttribute("width","16");svg.setAttribute("height","16");svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");svg.setAttribute("stroke-width","1.2");svg.setAttribute("aria-hidden","true");
 const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",pathData);svg.append(path);return svg;
}
async function openDocumentationReader(value:unknown,legacy:boolean,owner:AbortSignal|undefined,options:DocumentOptions){
 if(owner?.aborted)return;closeReader?.();
 const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
 const dialog=document.createElement("dialog");dialog.className="lsp-document-reader";dialog.setAttribute("aria-label","文档阅读");
 const header=document.createElement("header"),title=document.createElement("h2"),close=document.createElement("button"),body=document.createElement("div"),lifetime=new AbortController();
 title.textContent=options.title??"文档";close.type="button";close.className="lsp-reader-close";close.append(expandIcon("M4 4l8 8M12 4l-8 8"));close.setAttribute("aria-label","关闭文档");
 body.className="lsp-reader-body";body.tabIndex=0;body.setAttribute("aria-label","文档正文");body.setAttribute("aria-busy","true");body.textContent="正在载入文档";
 header.append(title,close);dialog.append(header,body);
 let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;lifetime.abort();owner?.removeEventListener("abort",dispose);if(dialog.open)dialog.close();dialog.remove();if(closeReader===dispose)closeReader=undefined;if(previous?.isConnected)previous.focus({preventScroll:true});};
 closeReader=dispose;close.addEventListener("click",dispose);dialog.addEventListener("cancel",event=>{event.preventDefault();dispose();});owner?.addEventListener("abort",dispose,{once:true});
 document.body.append(dialog);
 try{
  dialog.showModal();body.focus();
  const content=await renderDocumentation(value,legacy,lifetime.signal,{...options,expanded:true});
  if(disposed)return;
  body.replaceChildren();body.setAttribute("aria-busy","false");
  if(content)body.append(content);else body.textContent="无文档内容";
 }catch{dispose();}
}

