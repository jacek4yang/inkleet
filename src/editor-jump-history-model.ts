export type JumpVisit={selection:{ranges:{anchor:number;head:number}[];mainIndex:number};scroll:{top:number;left:number}};
export type JumpHistory={entries:JumpVisit[];index:number};
export const emptyJumpHistory=():JumpHistory=>({entries:[],index:-1});
const copy=(v:JumpVisit):JumpVisit=>({selection:{ranges:v.selection.ranges.map(r=>({...r})),mainIndex:v.selection.mainIndex},scroll:{...v.scroll}});
const same=(a:JumpVisit,b:JumpVisit)=>a.selection.mainIndex===b.selection.mainIndex&&a.selection.ranges.length===b.selection.ranges.length&&a.selection.ranges.every((r,i)=>r.anchor===b.selection.ranges[i].anchor&&r.head===b.selection.ranges[i].head);
export function recordJump(history:JumpHistory,origin:JumpVisit,target:JumpVisit):JumpHistory{
 if(same(origin,target))return history;
 const entries=history.entries.slice(0,history.index+1).map(copy);
 if(!entries.length||!same(entries[entries.length-1],origin))entries.push(copy(origin));
 else entries[entries.length-1]=copy(origin);
 entries.push(copy(target));if(entries.length>64)entries.splice(0,entries.length-64);
 return {entries,index:entries.length-1};
}
export function moveJump(history:JumpHistory,current:JumpVisit,direction:-1|1):{history:JumpHistory;target:JumpVisit}|null{
 const index=history.index+direction;
 if(history.index<0||index<0||index>=history.entries.length)return null;
 const entries=history.entries.map(copy);entries[history.index]=copy(current);
 return {history:{entries,index},target:copy(entries[index])};
}
