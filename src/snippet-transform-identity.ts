
import {snippetParserIdentity,SnippetLimitError,snippetLimits} from "./snippet-budget.ts";
import {validatePreparedSnippet} from "./snippet-validation.ts";
import type {PreparedSnippet,PreparedTransform,SnippetField} from "./snippet-prepare.ts";
/** Stable live occurrence identities are densified only at the worker boundary. */
export function encodeSnippetSnapshot(text:string,fields:SnippetField[],navigation:string[],transforms:PreparedTransform[]){
 if(text.length>snippetLimits.output||fields.length>snippetLimits.occurrences||navigation.length>snippetLimits.groups||transforms.length>snippetLimits.transforms)throw new SnippetLimitError("Snippet snapshot limit");
 const stableToWire=new Map<number,number>(),wireToStable:number[]=[];
 for(let i=0;i<fields.length;i++){
  const id=fields[i].id;if(!Number.isSafeInteger(id)||id<0||stableToWire.has(id))throw new SnippetLimitError("Invalid live snippet identity");
  stableToWire.set(id,i);wireToStable.push(id);
 }
 const reference=(id:number)=>{const wire=stableToWire.get(id);if(wire===undefined)throw new SnippetLimitError("Missing live snippet identity");return wire;};
 for(const transform of transforms)if(transform.sourceGroup!==undefined&&!fields.some(f=>!f.derived&&f.group===transform.sourceGroup))throw new SnippetLimitError("Missing editable transform source");
 const prepared=validatePreparedSnippet({schemaVersion:1,parserIdentity:snippetParserIdentity,text,
  fields:fields.map((f,id)=>({...f,id,parent:f.parent===null?null:reference(f.parent)})),
  navigation,transforms:transforms.map(t=>({...t,target:reference(t.target)})),
  needsTransformEvaluation:transforms.length>0,transformState:transforms.length?"pending":"resolved"});
 return {prepared,wireToStable};
}
/** Returned ranges overlay existing metadata; worker IDs never become live IDs. */
export function restoreSnippetFields<T extends SnippetField>(result:PreparedSnippet,original:T[],wireToStable:number[],offset=0):T[]|null{
 if(result.fields.length!==original.length||wireToStable.length!==original.length)return null;
 if(original.length>snippetLimits.occurrences||new Set(wireToStable).size!==wireToStable.length)return null;
 const byId=new Map(original.map(f=>[f.id,f]));if(byId.size!==original.length)return null;
 const restored:T[]=[];
 for(let index=0;index<result.fields.length;index++){
  const field=result.fields[index],previous=byId.get(wireToStable[index]);
  if(!previous||field.id!==index||field.group!==previous.group||field.derived!==previous.derived||field.final!==previous.final||
    (field.parent===null?null:wireToStable[field.parent])!==previous.parent||
    (field.choices?.length??0)!==(previous.choices?.length??0)||field.choices?.some((value,i)=>value!==previous.choices?.[i]))return null;
  restored.push({...previous,from:field.from+offset,to:field.to+offset});
 }
 return restored;
}

/** Removed sources retire derived ownership, never reinterpret it as empty input. */
export function retainLiveTransforms<T extends SnippetField>(fields:T[],transforms:PreparedTransform[]){
 const present=new Set(fields.map(f=>f.id)),sources=new Set(fields.filter(f=>!f.derived).map(f=>f.group));
 const retired=new Set(transforms.filter(t=>present.has(t.target)&&t.sourceGroup!==undefined&&!sources.has(t.sourceGroup)).map(t=>t.target));
 return {fields:fields.filter(f=>!retired.has(f.id)),transforms:transforms.filter(t=>present.has(t.target)&&!retired.has(t.target))};
}
