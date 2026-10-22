/** Bound the wait, not the writes: timeout never aborts a save or forces exit. */
export async function waitForCloseWrites(work:()=>Promise<void>,timeoutMs=15000):Promise<void>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await Promise.race([
   work(),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("保存仍未完成，窗口保持打开。请稍后重试，或先导出草稿。")),timeoutMs);}),
  ]);
 }finally{if(timer!==undefined)clearTimeout(timer);}
}
