import {searchDocumentSegments} from "./document-search-model";
type Piece={node:Text;from:number;to:number};
type Segment={text:string;pieces:Piece[]};
const blocks="p,li,pre,blockquote,td,th,h1,h2,h3,h4,h5,h6,.lsp-document-section";
function indexBody(body:HTMLElement):Segment[]|null{
 const segments:Segment[]=[];let owner:Element|null=null,current:Segment|null=null,units=0,nodes=0;
 const walker=document.createTreeWalker(body,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{
  acceptNode(node){return node instanceof Element&&node.matches("button,input,select,textarea,.lsp-document-limit")?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;}
 });
 let node:Node|null;
 while((node=walker.nextNode())){
  if(++nodes>32768)return null;
  if(node instanceof Element){if(node.tagName==="BR"){owner=null;current=null;}continue;}
  if(!(node instanceof Text)||!node.data)continue;
  const block=node.parentElement?.closest(blocks)??body;
  if(!node.data.trim()&&block.matches(".lsp-document-section")&&!block.matches(".lsp-document-plain")){owner=null;current=null;continue;}
  if(owner!==block||!current){current={text:"",pieces:[]};segments.push(current);owner=block;}
  if((units+=node.length)>524288)return null;
  const from=current.text.length;current.text+=node.data;current.pieces.push({node,from,to:current.text.length});
 }
 return segments;
}
function icon(path:string){
 const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
 for(const [key,value] of Object.entries({viewBox:"0 0 16 16",width:"16",height:"16",fill:"none",stroke:"currentColor","stroke-width":"1.4","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"}))svg.setAttribute(key,value);
 const shape=document.createElementNS(svg.namespaceURI,"path");shape.setAttribute("d",path);svg.append(shape);return svg;
}
function reveal(mark:HTMLElement,body:HTMLElement){
 // Only scroll the reader and its nested code blocks, never the underlying app.
 for(let parent=mark.parentElement;parent;parent=parent.parentElement){
  const target=mark.getBoundingClientRect(),bounds=parent.getBoundingClientRect();
  const top=bounds.top+parent.clientTop,left=bounds.left+parent.clientLeft;
  if(parent.scrollHeight>parent.clientHeight){if(target.top<top)parent.scrollTop-=top-target.top;else if(target.bottom>top+parent.clientHeight)parent.scrollTop+=target.bottom-top-parent.clientHeight;}
  if(parent.scrollWidth>parent.clientWidth){if(target.left<left)parent.scrollLeft-=left-target.left;else if(target.right>left+parent.clientWidth)parent.scrollLeft+=target.right-left-parent.clientWidth;}
  if(parent===body)break;
 }
}
export function documentReaderSearch(dialog:HTMLDialogElement,body:HTMLElement,header:HTMLElement){
 const bar=document.createElement("div"),input=document.createElement("input"),count=document.createElement("output");
 bar.className="lsp-reader-find";bar.hidden=true;input.type="search";input.placeholder="查找";input.setAttribute("aria-label","查找文档内容");input.autocomplete="off";input.spellcheck=false;
 count.setAttribute("role","status");count.setAttribute("aria-live","polite");count.className="lsp-reader-find-count";
 const button=(label:string,path:string)=>{const node=document.createElement("button");node.type="button";node.setAttribute("aria-label",label);node.title=label;node.append(icon(path));return node;};
 const trigger=button("查找文档 · Ctrl+F","m10.5 10.5 3.5 3.5M11.5 6.5a5 5 0 1 1-10 0 5 5 0 0 1 10 0");
 const previous=button("上一个匹配 · Shift+Enter","m4 10 4-4 4 4"),next=button("下一个匹配 · Enter","m4 6 4 4 4-4"),close=button("关闭查找","m4 4 8 8M12 4l-8 8");
 trigger.className="lsp-reader-find-trigger";bar.append(input,count,previous,next,close);header.insertBefore(trigger,header.lastElementChild);header.after(bar);
 let disposed=false,composing=false,timer:ReturnType<typeof setTimeout>|undefined,active=0,query="";
 let segments:Segment[]|null=[],result=searchDocumentSegments([],"");
 const marks:HTMLElement[]=[],replacements:{original:Text;nodes:Node[]}[]=[];
 function unmark(){
  for(const {original,nodes} of replacements){
   if(nodes[0]?.parentNode){nodes[0].parentNode!.replaceChild(original,nodes[0]);for(const node of nodes.slice(1))node.parentNode?.removeChild(node);}
  }
  replacements.length=0;marks.length=0;
 }
 function render(direction=0,reset=false){
  clearTimeout(timer);if(disposed||composing||bar.hidden)return;
  unmark();
  const changed=input.value!==query;
  if(changed)direction=0;
  if(reset||changed){
   active=0;query=input.value;
   result=segments?searchDocumentSegments(segments.map(segment=>segment.text),query):{matches:new Int32Array(0),error:"text-limit"};
  }
  const total=result.matches.length/3;
  previous.disabled=next.disabled=total===0;
  if(result.error){count.textContent=result.error==="query-limit"?"查询过长":"内容过多";return;}
  if(!query){count.textContent="";return;}
  if(!total){count.textContent=body.getAttribute("aria-busy")==="true"?"载入中":"0 / 0";return;}
  active=(active+direction+total)%total;
  count.textContent=(active+1)+" / "+total;
  const offset=active*3,segment=segments![result.matches[offset]],from=result.matches[offset+1],to=result.matches[offset+2];
  for(const piece of segment.pieces){
   if(piece.to<=from||piece.from>=to)continue;
   const start=Math.max(0,from-piece.from),end=Math.min(piece.node.length,to-piece.from);
   const mark=document.createElement("mark");mark.className="lsp-reader-search-match";mark.textContent=piece.node.data.slice(start,end);
   const nodes:Node[]=[];
   if(start)nodes.push(document.createTextNode(piece.node.data.slice(0,start)));
   nodes.push(mark);
   if(end<piece.node.length)nodes.push(document.createTextNode(piece.node.data.slice(end)));
   piece.node.replaceWith(...nodes);replacements.push({original:piece.node,nodes});marks.push(mark);
  }
  if(marks.length)reveal(marks[0],body);
 }
 const schedule=()=>{clearTimeout(timer);if(!composing)timer=setTimeout(()=>render(0,true),100);};
 const open=()=>{if(disposed)return;bar.hidden=false;input.focus();input.select();render();};
 const hide=()=>{clearTimeout(timer);bar.hidden=true;unmark();if(!disposed)body.focus({preventScroll:true});};
 const cancel=()=>{if(composing)return true;if(!bar.hidden){hide();return true;}return false;};
 const key=(event:KeyboardEvent)=>{
  if(event.isComposing||event.keyCode===229||composing)return;
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==="f"){event.preventDefault();event.stopPropagation();open();}
  else if(!bar.hidden&&event.key==="Escape"){event.preventDefault();event.stopPropagation();hide();}
  else if(!bar.hidden&&event.target===input&&event.key==="Enter"){event.preventDefault();render(event.shiftKey?-1:1);}
 };
 const start=()=>{composing=true;clearTimeout(timer);},end=()=>{composing=false;schedule();};
 const backward=()=>render(-1),forward=()=>render(1);
 dialog.addEventListener("keydown",key,true);input.addEventListener("input",schedule);input.addEventListener("compositionstart",start);input.addEventListener("compositionend",end);
 trigger.addEventListener("click",open);previous.addEventListener("click",backward);next.addEventListener("click",forward);close.addEventListener("click",hide);
 previous.disabled=next.disabled=true;
 return {
  refresh(){if(disposed)return;unmark();const content=body.querySelector<HTMLElement>(".lsp-documentation");segments=content?indexBody(content):[];if(!bar.hidden)render(0,true);else{query="";result=searchDocumentSegments([],"");}},
  cancel,
  destroy(){
   if(disposed)return;disposed=true;clearTimeout(timer);unmark();segments=[];result=searchDocumentSegments([],"");
   dialog.removeEventListener("keydown",key,true);input.removeEventListener("input",schedule);input.removeEventListener("compositionstart",start);input.removeEventListener("compositionend",end);
   trigger.removeEventListener("click",open);previous.removeEventListener("click",backward);next.removeEventListener("click",forward);close.removeEventListener("click",hide);
   trigger.remove();bar.remove();
  },
 };
}
