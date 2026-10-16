import {marked} from "marked";
self.onmessage=(event:MessageEvent<{parts:{kind:string;text:string}[]}>)=>{
 try{
  const parts=event.data.parts;
  if(!Array.isArray(parts)||parts.length>100||parts.some(p=>typeof p.text!=="string")||parts.reduce((n,p)=>n+p.text.length,0)>262144)throw Error("document limit");
  const html=parts.map(p=>p.kind==="markdown"?marked.parse(p.text,{async:false,gfm:true}):null);
  if(html.reduce((n,h)=>n+(h?.length??0),0)>262144)throw Error("render limit");
  self.postMessage({html});
 }catch{self.postMessage({error:true});}
};
