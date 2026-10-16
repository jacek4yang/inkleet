import DOMPurify from "dompurify";
import {documentationParts} from "./lsp-document-model";
let activeWorkers=0;
const cache=new Map<string,(string|null)[]>();let cacheBytes=0;
const tags=["p","br","hr","strong","em","del","blockquote","ul","ol","li","pre","code","table","thead","tbody","tr","th","td","h1","h2","h3","h4","h5","h6","kbd","sub","sup"];
export async function renderDocumentation(value:unknown,legacy=false,signal?:AbortSignal):Promise<HTMLElement|null>{
 const parts=documentationParts(value,legacy);if(!parts.length||signal?.aborted)return null;
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
  dom.append(section);
 }
 return dom;
}
