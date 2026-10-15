import {ChangeSet} from "@codemirror/state";
import {SnippetBudget,SnippetLimitError,snippetLimits} from "./snippet-budget.ts";
import {validatePreparedSnippet} from "./snippet-validation.ts";
import type {PreparedSnippet,PreparedTransform,TransformFormat,SnippetField} from "./snippet-prepare.ts";
// This module is worker-only. The owner enforces a wall-clock deadline by
// terminating the worker; a timer inside a regex evaluation cannot interrupt it.
function caseValue(value:string,operation:string,budget:SnippetBudget):string{
 budget.copy(value.length*3);
 let result=value;
 switch(operation){
  case "upcase":result=value.toLocaleUpperCase();break;
  case "downcase":result=value.toLocaleLowerCase();break;
  case "capitalize":result=value?value[0].toLocaleUpperCase()+value.slice(1):"";break;
  case "pascalcase":result=(value.match(/[\p{L}0-9]+/gu)??[value]).map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join("");break;
  case "camelcase":result=(value.match(/[\p{L}0-9]+/gu)??[value]).map((word,i)=>(i?word.charAt(0).toUpperCase():word.charAt(0).toLowerCase())+word.slice(1)).join("");break;
  case "snakecase":result=value.replace(/(\p{Ll})(\p{Lu})/gu,"$1_$2").replace(/[\s\-]+/g,"_").toLowerCase();break;
  case "kebabcase":{
   if(!value.match(/[\p{L}0-9]+/gu))break;
   const cleaned=value.trim().replace(/^_+|_+$/g,"");
   const words=cleaned.match(/\p{Lu}{2,}(?=\p{Lu}\p{Ll}+[0-9]*|[\s_-]|$)|\p{Lu}?\p{Ll}+[0-9]*|\p{Lu}(?=\p{Lu}\p{Ll})|\p{Lu}(?=[\s_-]|$)|[0-9]+/gu);
   result=(words??cleaned.split(/[\s_-]+/).filter(Boolean)).map(word=>word.toLowerCase()).join("-");break;
  }
 }
 if(result.length>snippetLimits.output)throw new SnippetLimitError("Snippet transform output limit");
 return result;
}
function replacement(format:TransformFormat[],groups:RegExpExecArray|string[],budget:SnippetBudget):string{
 const chunks:string[]=[];let length=0;
 for(const node of format){
  budget.step();let value:string;
  if(node.kind==="text")value=node.value;
  else{
   const capture=groups[node.index]??"";
   value=node.operation?caseValue(capture,node.operation,budget):
    capture&&node.ifValue!==undefined?node.ifValue:
    !capture&&node.elseValue!==undefined?node.elseValue:capture;
  }
  if(length+value.length>snippetLimits.output)throw new SnippetLimitError("Snippet transform output limit");
  budget.copy(value.length);length+=value.length;chunks.push(value);
 }
 budget.copy(length);return chunks.join("");
}
function applyTransform(input:string,transform:PreparedTransform,budget:SnippetBudget):string{
 if(input.length>snippetLimits.output)throw new SnippetLimitError("Snippet transform input limit");
 const regexp=new RegExp(transform.pattern,transform.flags);
 const chunks:string[]=[];let length=0,lastEnd=0,matches=0;
 const emit=(value:string)=>{if(length+value.length>snippetLimits.output)throw new SnippetLimitError("Snippet transform output limit");budget.copy(value.length);length+=value.length;chunks.push(value);};
 while(true){
  budget.step();
  const match=regexp.exec(input);
  if(!match)break;
  if(++matches>4096)throw new SnippetLimitError("Snippet transform match limit");
  if(match.index<lastEnd)throw new Error("Non-monotonic snippet regex match");
  emit(input.slice(lastEnd,match.index));emit(replacement(transform.format,match,budget));lastEnd=match.index+match[0].length;
  if(!regexp.global)break;
  if(match[0].length===0){
   if(regexp.lastIndex>=input.length)break;
   const position=regexp.lastIndex,unicode=regexp.unicode||transform.flags.includes("v");
   const first=input.charCodeAt(position),second=input.charCodeAt(position+1);
   regexp.lastIndex=position+(unicode&&first>=0xd800&&first<=0xdbff&&second>=0xdc00&&second<=0xdfff?2:1);
  }
 }
 if(!matches&&transform.format.some(node=>node.kind==="capture"&&!!node.elseValue))return replacement(transform.format,[],budget);
 emit(input.slice(lastEnd));budget.copy(length);return chunks.join("");
}
export function evaluateSnippetTransforms(prepared:PreparedSnippet):PreparedSnippet{
 const original=validatePreparedSnippet(prepared);
 if(!original.needsTransformEvaluation)return original;
 const budget=new SnippetBudget();
 let text=original.text,fields=original.fields;
 const transforms=original.transforms;
 const byId=new Map(fields.map(f=>[f.id,f]));
 const ancestor=(parent:number,child:SnippetField)=>{
  let current=child.parent;
  while(current!==null){budget.step();if(current===parent)return true;current=byId.get(current)?.parent??null;}
  return false;
 };
 const sources=transforms.map(t=>t.sourceGroup===undefined?null:fields.find(f=>f.group===t.sourceGroup&&!f.derived)??null);
 const dependencies=transforms.map((_t,index)=>sources[index]?transforms.map((t,i)=>ancestor(sources[index]!.id,byId.get(t.target)! )?i:-1).filter(i=>i>=0):[]);
 const completed=new Set<number>();
 while(completed.size<transforms.length){
  const index=transforms.findIndex((_t,i)=>!completed.has(i)&&dependencies[i].every(id=>completed.has(id)));
  if(index<0)throw new Error("Cyclic snippet transform dependency");
  const transform=transforms[index],target=fields[transform.target];
  const source=sources[index]?fields[sources[index]!.id]:null;
  const input=transform.sourceValue??(source?text.slice(source.from,source.to):"");
  const output=applyTransform(input,transform,budget),nextLength=text.length-(target.to-target.from)+output.length;
  if(nextLength>snippetLimits.output)throw new SnippetLimitError("Expanded snippet output limit");
  budget.copy(nextLength);
  const changes=ChangeSet.of({from:target.from,to:target.to,insert:output},text.length);
  const nextFields=fields.map(f=>{
   budget.step();
   if(f.id===target.id)return {...f,to:f.from+output.length};
   if(ancestor(f.id,target))return {...f,from:changes.mapPos(f.from,-1),to:changes.mapPos(f.to,1)};
   if(f.from===f.to){const position=changes.mapPos(f.from,f.id<target.id?-1:1);return {...f,from:position,to:position};}
   return {...f,from:changes.mapPos(f.from,1),to:changes.mapPos(f.to,-1)};
  });
  text=text.slice(0,target.from)+output+text.slice(target.to);fields=nextFields;completed.add(index);
 }
 return validatePreparedSnippet({...original,text,fields,needsTransformEvaluation:false,transformState:"resolved"});
}
