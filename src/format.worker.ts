import { diff } from "@codemirror/merge";
self.onmessage=(event:MessageEvent<{before:string;after:string}>)=>{
  const {before,after}=event.data;
  try{
    if(before.length>1024*1024||after.length>1024*1024)throw Error("格式化正文过大");
    const changes=diff(before,after,{scanLimit:500,timeout:20}).map(c=>({from:c.fromA,to:c.toA,insert:after.slice(c.fromB,c.toB)}));
    if(changes.length>4096)throw Error("格式化修改过多");
    self.postMessage({changes});
  }catch(error){self.postMessage({error:String(error)});}
};
