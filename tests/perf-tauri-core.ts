// Test-only build overlay. Never shipped by the normal Vite configuration.
import {invoke as actualInvoke} from "../node_modules/@tauri-apps/api/core.js";
export * from "../node_modules/@tauri-apps/api/core.js";
type Entry={command:string;kind:string|null;textCodeUnits:number|null;baselineCodeUnits:number|null;startAt:number;syncMs?:number;endAt?:number;ok?:boolean};
type Trace={active:boolean;sample:{ipc:Entry[]}};
const state=globalThis as unknown as {__nativePerf?:Trace;__inkleetIpcInstrumentation?:boolean};
state.__inkleetIpcInstrumentation=true;
const tracked=new Set(["checkpoint_draft","update_language_document","language_request","language_diagnostics"]);
export function invoke<T>(...args:Parameters<typeof actualInvoke>):Promise<T>{
 const trace=state.__nativePerf;
 if(!trace?.active||!tracked.has(args[0]))return actualInvoke<T>(...args);
 const value=(args[1]??{}) as Record<string,unknown>;
 const entry:Entry={command:args[0],kind:typeof value.kind==="string"?value.kind:null,textCodeUnits:typeof value.text==="string"?value.text.length:null,baselineCodeUnits:typeof value.baseline==="string"?value.baseline.length:null,startAt:performance.now()};
 trace.sample.ipc.push(entry);
 try{
  const result=actualInvoke<T>(...args);
  entry.syncMs=performance.now()-entry.startAt;
  void result.then(()=>{entry.endAt=performance.now();entry.ok=true;},()=>{entry.endAt=performance.now();entry.ok=false;});
  return result;
 }catch(error){entry.syncMs=performance.now()-entry.startAt;entry.endAt=performance.now();entry.ok=false;throw error;}
}
