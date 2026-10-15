import {snippetLimits,SnippetLimitError} from "./snippet-budget.ts";
import type {PreparedSnippet,VariableValue} from "./snippet-prepare.ts";
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const fail=():never=>{throw new SnippetLimitError("Invalid prepared snippet");};
export function validateSnippetVariables(value:unknown):Record<string,VariableValue>{
 if(!object(value)||Object.keys(value).length>128)fail();
 const output:Record<string,VariableValue>=Object.create(null);let units=0;
 for(const [name,item]of Object.entries(value)){
  if(name.length>256||!object(item))fail();
  if(item.kind==="unset")output[name]={kind:"unset"};
  else if(item.kind==="value"&&typeof item.value==="string"&&item.value.length<=snippetLimits.output){
   units+=item.value.length;if(units>snippetLimits.copies)fail();output[name]={kind:"value",value:item.value};
  }else fail();
 }
 return output;
}
export function validatePreparedSnippet(value:unknown):PreparedSnippet{
 if(!object(value)||value.schemaVersion!==1||typeof value.parserIdentity!=="string"||value.parserIdentity.length>256||
 typeof value.text!=="string"||value.text.length>snippetLimits.output||
 !Array.isArray(value.fields)||value.fields.length>snippetLimits.occurrences||
 !Array.isArray(value.navigation)||value.navigation.length>snippetLimits.groups||
 !Array.isArray(value.transforms)||value.transforms.length>snippetLimits.transforms||
 value.needsTransformEvaluation!==(value.transforms.length>0))fail();
 const text=value.text as string,fields=value.fields as any[],groups=new Set<string>();
 const boundary=(n:number)=>n===0||n===text.length||!(text.charCodeAt(n-1)>=0xd800&&text.charCodeAt(n-1)<=0xdbff&&text.charCodeAt(n)>=0xdc00&&text.charCodeAt(n)<=0xdfff);
 let units=text.length,choices=0;
 const bounded=(v:unknown,max=snippetLimits.output):v is string=>{
  if(typeof v!=="string"||v.length>max)return false;units+=v.length;return units<=snippetLimits.copies;
 };
 for(let i=0;i<fields.length;i++){
  const f=fields[i];
  if(!object(f)||f.id!==i||!bounded(f.group,512)||!integer(f.from)||!integer(f.to)||f.from>f.to||f.to>text.length||
   !boundary(f.from)||!boundary(f.to)||typeof f.derived!=="boolean"||typeof f.final!=="boolean")fail();
  if(f.parent!==null){
   if(!integer(f.parent)||f.parent>=i)fail();
   const p=fields[f.parent];if(p.derived||f.from<p.from||f.to>p.to)fail();
  }
  if(f.choices!==undefined){
   if(!Array.isArray(f.choices)||(choices+=f.choices.length)>snippetLimits.choices||!f.choices.every((x:unknown)=>bounded(x)))fail();
  }
  groups.add(f.group);if(groups.size>snippetLimits.groups)fail();
  for(let j=0;j<i;j++){const p=fields[j];if(p.from<f.from&&f.from<p.to&&p.to<f.to||f.from<p.from&&p.from<f.to&&f.to<p.to)fail();}
 }
 const navigation=new Set<string>();
 for(const group of value.navigation){
  if(typeof group!=="string"||navigation.has(group)||!fields.some(f=>f.group===group&&!f.derived))fail();navigation.add(group);
 }
 if(navigation.size!==new Set(fields.filter(f=>!f.derived).map(f=>f.group)).size)fail();
 const targets=new Set<number>();
 for(const t of value.transforms){
  if(!object(t)||!integer(t.target)||!fields[t.target]?.derived||!bounded(t.pattern,snippetLimits.pattern)||!bounded(t.flags,8)||
   !/^[dgimsuvy]*$/.test(t.flags)||new Set(t.flags).size!==t.flags.length||t.flags.includes("u")&&t.flags.includes("v")||
   !Array.isArray(t.format)||t.format.length>snippetLimits.nodes)fail();
  if(targets.has(t.target))fail();targets.add(t.target);
  if(t.sourceGroup!==undefined&&(typeof t.sourceGroup!=="string"||!groups.has(t.sourceGroup)))fail();
  if(t.sourceValue!==undefined&&!bounded(t.sourceValue))fail();
  if((t.sourceGroup===undefined)===(t.sourceValue===undefined))fail();
  for(const f of t.format){
   if(!object(f))fail();
   if(f.kind==="text"){if(!bounded(f.value))fail();}
   else if(f.kind==="capture"){
    if(!integer(f.index))fail();
    for(const key of ["operation","ifValue","elseValue"])if(f[key]!==undefined&&!bounded(f[key]))fail();
   }else fail();
  }
 }
 if(fields.some(f=>f.derived&&!targets.has(f.id)))fail();
 return value as PreparedSnippet;
}
