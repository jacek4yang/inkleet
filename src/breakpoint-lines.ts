export function sameBreakpointLines(a:readonly number[],b:readonly number[]):boolean{
  return a.length===b.length&&a.every((line,index)=>line===b[index]);
}
