export type DocumentationPart={kind:"markdown"|"plaintext"|"code";text:string;language?:string};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export function documentationParts(value:unknown,legacy=false):DocumentationPart[]{
 const result:DocumentationPart[]=[];let remaining=32768;
 for(const part of (Array.isArray(value)?value.slice(0,20):[value])){
  if(remaining<=0)break;
  let text:string|undefined,kind:DocumentationPart["kind"]="plaintext",language:string|undefined;
  if(typeof part==="string"){text=part;kind=legacy?"markdown":"plaintext";}
  else if(object(part)&&typeof part.value==="string"){
   text=part.value;
   if(part.kind==="markdown")kind="markdown";
   else if(part.kind==="plaintext")kind="plaintext";
   else if(legacy&&typeof part.language==="string"){kind="code";language=part.language.slice(0,40);}
  }
  if(!text)continue;
  text=text.slice(0,remaining);remaining-=text.length;
  result.push({kind,text,...(language?{language}: {})});
 }
 return result;
}
function boundary(text:string,n:number){return !(n>0&&n<text.length&&/[\uD800-\uDBFF]/.test(text[n-1])&&/[\uDC00-\uDFFF]/.test(text[n]));}
export function activeParameterSpan(label:string,parameter:unknown):{from:number;to:number}|null{
 if(!object(parameter))return null;const value=parameter.label;
 if(Array.isArray(value)&&value.length===2){
  const [from,to]=value;
  return Number.isInteger(from)&&Number.isInteger(to)&&from>=0&&to>from&&to<=label.length&&boundary(label,from)&&boundary(label,to)?{from,to}:null;
 }
 if(typeof value!=="string"||!value)return null;
 const from=label.indexOf(value);
 // An ambiguous string cannot identify a parameter reliably; leave it unmarked.
 return from>=0&&label.indexOf(value,from+1)<0?{from,to:from+value.length}:null;
}
export function completionKind(kind:unknown):string{
 return ({1:"text",2:"method",3:"function",4:"constructor",5:"property",6:"variable",7:"class",8:"interface",9:"namespace",10:"property",11:"unit",12:"value",13:"enum",14:"keyword",15:"snippet",16:"color",17:"file",18:"reference",19:"folder",20:"enum",21:"constant",22:"struct",23:"event",24:"operator",25:"type"} as Record<number,string>)[typeof kind==="number"?kind:0]??"text";
}
