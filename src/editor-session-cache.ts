/** Inactive editor history only. Draft persistence is owned by the workspace.
 * The UTF-16 admission budget excludes undo history/extension overhead: it is
 * not a heap-memory bound. Active editors are removed with take(). */
export function createEditorSessionCache<T extends {state:{doc:{length:number}}}>(maxEntries=12,maxUnits=2*1024*1024){
 if(!Number.isSafeInteger(maxEntries)||maxEntries<1||!Number.isSafeInteger(maxUnits)||maxUnits<0)throw Error("Invalid editor session cache limits");
 const entries=new Map<string,{value:T;units:number}>();
 let units=0;
 function remove(key:string){
  const entry=entries.get(key);
  if(entry){entries.delete(key);units-=entry.units;}
  return entry;
 }
 return {
  take(key:string):T|undefined{return remove(key)?.value;},
  set(key:string,value:T):boolean{
   const size=value.state.doc.length;
   if(!Number.isSafeInteger(size)||size<0)throw Error("Invalid editor session size");
   remove(key);
   // Never retain an older state under this key when its replacement is too big.
   if(size>maxUnits)return false;
   while(entries.size&&(entries.size>=maxEntries||units+size>maxUnits))remove(entries.keys().next().value!);
   entries.set(key,{value,units:size});units+=size;return true;
  },
  get size(){return entries.size;},
  get retainedUnits(){return units;},
 };
}
