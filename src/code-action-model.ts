export type SourceChange={from:number;to:number;insert:string};
export type SourceAction={token:number;title:string;kind:string;preferred:boolean};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
export function sourceActions(value:unknown):SourceAction[]{
  if(!Array.isArray(value)||value.length>64)throw Error("代码操作列表无效");
  const seen=new Set<number>();
  return value.map(item=>{
    if(!object(item)||!Number.isSafeInteger(item.token)||(item.token as number)<=0||seen.has(item.token as number)||typeof item.title!=="string"||!item.title.trim()||item.title.length>1024||typeof item.kind!=="string"||! /^(quickfix|refactor)(\.|$)/.test(item.kind))throw Error("代码操作条目无效");
    seen.add(item.token as number);
    return {token:item.token as number,title:item.title,kind:item.kind,preferred:item.preferred===true};
  });
}
/** Defense in depth over normalized, backend-owned LSP edits. No truncation. */
export function sourceActionChanges(text:string,value:unknown):SourceChange[]{
  if(!Array.isArray(value)||!value.length||value.length>512)throw Error("没有可应用的代码操作编辑");
  const lines=text.split("\n"),starts:number[]=[];let offset=0;
  for(const line of lines){starts.push(offset);offset+=line.length+1;}
  function point(value:unknown){
    if(!object(value)||!Number.isSafeInteger(value.line)||!Number.isSafeInteger(value.character))throw Error("代码操作位置无效");
    const row=value.line as number,col=value.character as number,line=lines[row];
    if(row<0||line===undefined||col<0||col>line.length||col>0&&col<line.length&&/[\uD800-\uDBFF]/.test(line[col-1])&&/[\uDC00-\uDFFF]/.test(line[col]))throw Error("代码操作位置越界或拆分 Unicode 字符");
    return starts[row]+col;
  }
  let total=0;
  const result=value.map(item=>{
    if(!object(item)||!object(item.range)||typeof item.newText!=="string"||item.newText.length>65536||"annotationId" in item)throw Error("代码操作编辑无效");
    const from=point(item.range.start),to=point(item.range.end);
    if(from>to)throw Error("代码操作范围无效");
    total+=item.newText.length;if(total>2*1024*1024)throw Error("代码操作编辑超过大小限制");
    return {from,to,insert:item.newText};
  }).sort((a,b)=>a.from-b.from||a.to-b.to);
  for(let i=1;i<result.length;i++)if(result[i].from<result[i-1].to||result[i].from===result[i-1].from)throw Error("代码操作编辑重叠");
  return result;
}
