import type {SourceSnapshot} from "./source-protocol";
export type SourceSelection={ranges:{anchor:number;head:number}[];mainIndex:number};
export type SourceVisit={source:SourceSnapshot;selection:SourceSelection;scroll:{top:number;left:number}};
export class SourceHistory{
 private entries:SourceVisit[];private index=0;
 constructor(initial:SourceVisit){this.entries=[initial];}
 get current(){return this.entries[this.index];}
 get canBack(){return this.index>0;}
 get canForward(){return this.index+1<this.entries.length;}
 get length(){return this.entries.length;}
 update(selection:SourceSelection,scroll:{top:number;left:number}){
  this.entries[this.index]={...this.current,selection:{ranges:selection.ranges.map(r=>({...r})),mainIndex:selection.mainIndex},scroll:{...scroll}};
 }
 push(visit:SourceVisit){
  const next=this.entries.slice(0,this.index+1);
  const current=this.current;
  if(current.source.uri===visit.source.uri&&current.source.text===visit.source.text&&JSON.stringify(current.selection)===JSON.stringify(visit.selection))return false;
  const shared=next.find(v=>v.source.uri===visit.source.uri&&v.source.text===visit.source.text)?.source;
  next.push({...visit,source:shared??visit.source});
  const bytes=()=>[...new Set(next.map(v=>v.source))].reduce((sum,s)=>sum+s.text.length*2,0);
  while(next.length>1&&(next.length>64||bytes()>16*1024*1024))next.shift();
  if(bytes()>16*1024*1024)throw Error("源码超过导航缓存限制");
  this.entries=next;this.index=next.length-1;return true;
 }
 move(direction:-1|1){const next=this.index+direction;if(next<0||next>=this.entries.length)return false;this.index=next;return true;}
 clear(){this.entries=[];this.index=-1;}
}
