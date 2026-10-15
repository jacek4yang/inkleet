import {useSyncExternalStore} from "react";
export type LiveCode = {read:()=>string;subscribe:(listener:()=>void)=>()=>void};
/** Notifications are document-owned; old callbacks never read the selected tab. */
export class CodeSignals {
  private listeners=new Map<string,Set<()=>void>>();
  source(key:string,read:()=>string):LiveCode{
    return {read,subscribe:listener=>{
      let set=this.listeners.get(key);
      if(!set){set=new Set();this.listeners.set(key,set);}
      set.add(listener);
      return ()=>{set!.delete(listener);if(!set!.size&&this.listeners.get(key)===set)this.listeners.delete(key);};
    }};
  }
  notify(key:string){for(const listener of [...(this.listeners.get(key)??[])])listener();}
}
export function useCodeMismatch(source:LiveCode,expected:string|undefined):boolean{
  return useSyncExternalStore(source.subscribe,()=>expected!==undefined&&source.read()!==expected,()=>false);
}
export function useCodeEmpty(source:LiveCode,enabled:boolean):boolean{
  return useSyncExternalStore(source.subscribe,()=>enabled&&!source.read().trim(),()=>false);
}
