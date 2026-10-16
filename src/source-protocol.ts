export type SourcePosition={line:number;character:number};
export type SourceRange={start:SourcePosition;end:SourcePosition};
export type SourceTarget={uri:string;range:SourceRange};
export type SourceSnapshot={sourceId:number;uri:string;text:string;name:string;declaration:boolean;language:string};
export type SourceNavigator={
 primary:SourceSnapshot;
 originSelection:{ranges:{anchor:number;head:number}[];mainIndex:number};
 originScroll:{top:number;left:number};
 current:()=>boolean;
 definition:(source:SourceSnapshot,position:SourcePosition,signal:AbortSignal)=>Promise<{locations:SourceTarget[];omitted:number}>;
 load:(target:SourceTarget,signal:AbortSignal)=>Promise<SourceSnapshot|null>;
 origin:(target?:SourceTarget)=>void;
 cancel:()=>void;
};
export type Source=SourceSnapshot&{line:number;range:SourceRange;navigation:SourceNavigator};
export function sourceOffset(text:string,position:SourcePosition):number|null{
 if(!position||!Number.isSafeInteger(position.line)||!Number.isSafeInteger(position.character)||position.line<0||position.character<0)return null;
 let start=0;
 for(let n=0;n<position.line;n++){const end=text.indexOf("\n",start);if(end<0)return null;start=end+1;}
 const next=text.indexOf("\n",start),end=next<0?text.length:next,pos=start+position.character;
 if(pos>end||pos>start&&pos<end&&/[\uD800-\uDBFF]/.test(text[pos-1])&&/[\uDC00-\uDFFF]/.test(text[pos]))return null;
 return pos;
}
export function sourceSpan(text:string,range:SourceRange):{anchor:number;head:number}|null{
 const anchor=sourceOffset(text,range?.start),head=sourceOffset(text,range?.end);
 return anchor!==null&&head!==null&&anchor<=head?{anchor,head}:null;
}
export function sourceTargets(value:unknown):SourceTarget[]{
 const items=Array.isArray(value)?value:[value];if(items.length>256)throw Error("定义结果过多");
 const seen=new Set<string>(),result:SourceTarget[]=[];
 for(const item of items){
  if(!item||typeof item!=="object")continue;
  const uri=item.targetUri??item.uri,range=item.targetSelectionRange??item.range;
  if(typeof uri!=="string"||uri.length>8192||!uri.match(/^(file:\/\/|jdt:\/\/contents\/)/)||!range)continue;
  const points=[range.start,range.end];
  if(points.some(p=>!p||!Number.isSafeInteger(p.line)||!Number.isSafeInteger(p.character)||p.line<0||p.character<0))continue;
  if(range.start.line>range.end.line||range.start.line===range.end.line&&range.start.character>range.end.character)continue;
  const key=JSON.stringify([uri,range]);if(seen.has(key))continue;seen.add(key);
  if(result.length===32)throw Error("定义结果过多，请缩小查找范围");
  result.push({uri,range});
 }
 return result;
}
export function chooseSourceTarget(targets:SourceTarget[],signal:AbortSignal):Promise<SourceTarget|null>{
 if(signal.aborted)return Promise.resolve(null);
 if(targets.length<2)return Promise.resolve(targets[0]??null);
 return new Promise(resolve=>{
  const previous=document.activeElement,dialog=document.createElement("dialog");
  dialog.className="source-target-picker";dialog.setAttribute("aria-label","选择定义");
  const heading=document.createElement("h2");heading.textContent="转到定义";dialog.append(heading);
  let settled=false;
  const finish=(value:SourceTarget|null)=>{if(settled)return;settled=true;signal.removeEventListener("abort",abort);dialog.close();dialog.remove();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});resolve(value);};
  const abort=()=>finish(null);
  signal.addEventListener("abort",abort,{once:true});
  dialog.addEventListener("cancel",e=>{e.preventDefault();finish(null);});
  const buttons=targets.map(target=>{
   const button=document.createElement("button");button.type="button";
   const name=document.createElement("strong"),path=document.createElement("span");
   let visible=target.uri.split("?")[0];try{visible=decodeURI(visible);}catch{}
   name.textContent=(visible.split("/").pop()||visible)+":"+String(target.range.start.line+1);
   path.textContent=visible;button.append(name,path);button.onclick=()=>finish(target);dialog.append(button);return button;
  });
  dialog.addEventListener("keydown",event=>{
   if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
   event.preventDefault();const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
   buttons[event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length].focus();
  });
  document.body.append(dialog);dialog.showModal();buttons[0].focus();
 });
}
