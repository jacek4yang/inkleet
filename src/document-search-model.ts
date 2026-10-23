export type DocumentSearch={matches:Int32Array;error:null|"text-limit"|"query-limit"};
/** Literal Unicode-insensitive search. Compact triples contain segment/from/to
 * in the original UTF-16 text; every match remains reachable, including the tail. */
export function searchDocumentSegments(segments:readonly string[],query:string):DocumentSearch{
 const empty=new Int32Array(0);
 if(query.length>1024)return {matches:empty,error:"query-limit"};
 const units=segments.reduce((size,text)=>size+text.length,0);
 if(segments.length>32768||units>524288)return {matches:empty,error:"text-limit"};
 if(!query||!units)return {matches:empty,error:null};
 const pattern=new RegExp(query.replace(/[.*+?^{}$()|[\]\\]/g,"\\$&"),"giu");
 let storage=new Int32Array(Math.min(768,units*3)),used=0;
 for(let segment=0;segment<segments.length;segment++){
  pattern.lastIndex=0;
  let found:RegExpExecArray|null;
  while((found=pattern.exec(segments[segment]))!==null){
   if(used+3>storage.length){const next=new Int32Array(Math.min(units*3,Math.max(used+3,storage.length*2)));next.set(storage);storage=next;}
   storage[used++]=segment;storage[used++]=found.index;storage[used++]=found.index+found[0].length;
  }
 }
 return {matches:storage.subarray(0,used),error:null};
}
