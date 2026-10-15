/** CodeMirror Text snapshots are immutable. Share flattening across editor,
 * language-service and save consumers without retaining undo history strings. */
type Snapshot={readonly length:number;toString():string};
export function createSnapshotTextCache(maxEntries=4,maxUnits=2*1024*1024){
 if(!Number.isSafeInteger(maxEntries)||maxEntries<1||!Number.isSafeInteger(maxUnits)||maxUnits<0)throw Error("Invalid snapshot cache limits");
 const entries:{doc:Snapshot;text:string}[]=[];
 let units=0;
 return (doc:Snapshot):string=>{
  const index=entries.findIndex(entry=>entry.doc===doc);
  if(index>=0){
   const [entry]=entries.splice(index,1);entries.push(entry);return entry.text;
  }
  const text=doc.toString();
  if(text.length>maxUnits)return text;
  while(entries.length&&(entries.length>=maxEntries||units+text.length>maxUnits)){
   units-=entries.shift()!.text.length;
  }
  entries.push({doc,text});units+=text.length;
  return text;
 };
}
export const snapshotText=createSnapshotTextCache();
