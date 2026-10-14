export type DebugPosition = { line:number; column?:number; endLine?:number; endColumn?:number; frameId:number; execution:boolean };
export type DebugLocation = { line:number; from?:number; to?:number };
/** DAP uses one-based UTF-16 columns, not visual tab widths or code points.
 * Missing/default first columns are deliberately rendered at line precision. */
export function debugLocation(doc:{lines:number;line(n:number):{from:number;text:string}}, position:DebugPosition|null):DebugLocation|null {
  if(!position || !Number.isSafeInteger(position.line) || position.line<1 || position.line>doc.lines)return null;
  const line=doc.line(position.line), fallback={line:position.line};
  const offset=(n:number,c:number|undefined)=>{
    if(!Number.isSafeInteger(n)||n<1||n>doc.lines||!Number.isSafeInteger(c)||!c||c<1)return null;
    const row=doc.line(n), at=c-1;
    if(at>row.text.length)return null;
    if(at>0&&at<row.text.length&&/[\uD800-\uDBFF]/.test(row.text[at-1])&&/[\uDC00-\uDFFF]/.test(row.text[at]))return null;
    return row.from+at;
  };
  const from=offset(position.line,position.column);
  if(from===null)return fallback;
  const to=offset(position.endLine??position.line,position.endColumn);
  if(to!==null&&to>from)return {line:position.line,from,to};
  // Invalid or absent range is not an excuse to color a guessed expression.
  return position.column!>1?{line:position.line,from}:fallback;
}
