import {SnippetParser,Text,Placeholder,Choice,Variable,FormatString,Transform,type Marker} from "./vendor/snippet-parser.ts";
import {snippetLimits,SnippetLimitError,snippetParserIdentity} from "./snippet-budget.ts";
export type VariableValue={kind:"value";value:string}|{kind:"unset"};
export type SnippetField={id:number;group:string;from:number;to:number;parent:number|null;choices?:string[];derived:boolean;final:boolean};
export type TransformFormat={kind:"text";value:string}|{kind:"capture";index:number;operation?:string;ifValue?:string;elseValue?:string};
export type PreparedTransform={target:number;pattern:string;flags:string;format:TransformFormat[];sourceGroup?:string;sourceValue?:string};
export type PreparedSnippet={schemaVersion:1;parserIdentity:string;text:string;fields:SnippetField[];navigation:string[];transforms:PreparedTransform[];needsTransformEvaluation:boolean};
export {snippetParserIdentity} from "./snippet-budget.ts";
// Preparation is deliberately not an apply operation. Transform-bearing output
// remains pending until the owned evaluation worker completes it.
export function prepareSnippet(source:string,variables:Record<string,VariableValue>={}):PreparedSnippet{
 const root=new SnippetParser().parse(source);
 const budget=root.budget;
 if(!variables||typeof variables!=="object"||Array.isArray(variables)||Object.keys(variables).length>128)throw new SnippetLimitError("Snippet variable context limit");
 for(const [name,item]of Object.entries(variables)){
  if(name.length>256||!item||!(item.kind==="unset"||item.kind==="value"&&typeof item.value==="string"))throw new SnippetLimitError("Invalid snippet variable context");
  if(item.kind==="value"){if(item.value.length>snippetLimits.output)throw new SnippetLimitError("Snippet variable value limit");budget.copy(item.value.length);}
 }
 const fields:SnippetField[]=[],transforms:PreparedTransform[]=[],chunks:string[]=[],groups=new Set<string>();
 let length=0;
 const emit=(text:string)=>{if(length+text.length>snippetLimits.output)throw new SnippetLimitError("Snippet output limit");budget.copy(text.length);length+=text.length;chunks.push(text);};
 const field=(group:string,parent:number|null,derived=false,final=false,choices?:string[])=>{
  if(fields.length>=snippetLimits.occurrences)throw new SnippetLimitError("Snippet occurrence limit");
  groups.add(group);if(groups.size>snippetLimits.groups)throw new SnippetLimitError("Snippet group limit");
  const value:SnippetField={id:fields.length,group,from:length,to:length,parent,derived,final};
  if(choices)value.choices=choices.map(option=>{budget.copy(option.length);return option;});
  fields.push(value);return value;
 };
 const transform=(value:Transform,target:SnippetField,sourceGroup?:string,sourceValue?:string)=>{
  const format:TransformFormat[]=value.children.map(child=>{
   budget.step();
   if(child instanceof Text){budget.copy(child.value.length);return {kind:"text",value:child.value};}
   if(child instanceof FormatString)return {kind:"capture",index:child.index,operation:child.shorthandName,ifValue:child.ifValue,elseValue:child.elseValue};
   throw new Error("Unexpected transform format node");
  });
  transforms.push({target:target.id,pattern:value.regexSource,flags:value.regexFlags,format,sourceGroup,sourceValue});
 };
 type Frame={marker:Marker;parent:number|null;depth:number;opaque?:boolean}|{finish:SnippetField};
 const stack:Frame[]=[];
 const push=(children:Marker[],parent:number|null,depth:number,opaque=false)=>{for(let i=children.length-1;i>=0;i--)stack.push({marker:children[i],parent,depth,opaque});};
 push(root.children,null,0);
 while(stack.length){
  const frame=stack.pop()!;budget.step();
  if("finish"in frame){frame.finish.to=length;continue;}
  const {marker,parent,depth,opaque}=frame;budget.depthAt(depth);
  if(marker instanceof Text){emit(marker.value);continue;}
  if(marker instanceof Choice){if(!marker.options.length)throw new Error("Empty snippet choice");emit(marker.options[0].value);continue;}
  if(marker instanceof Placeholder){
   if(opaque){push(marker.children,parent,depth+1,true);continue;}
   const current=field("t:"+marker.index,parent,!!marker.transform,marker.index===0,marker.choice?.options.map(option=>option.value));
   if(marker.transform)transform(marker.transform,current,current.group);
   stack.push({finish:current});push(marker.children,current.id,depth+1,!!marker.transform);continue;
  }
  if(marker instanceof Variable){
   if(marker.name.length>256)throw new SnippetLimitError("Snippet variable name limit");
   const resolved=Object.prototype.hasOwnProperty.call(variables,marker.name)?variables[marker.name]:null;
   if(opaque){if(resolved?.kind==="value")emit(resolved.value);else if(marker.children.length)push(marker.children,parent,depth+1,true);else if(!resolved)emit(marker.name);continue;}
   if(marker.transform){
    if(!resolved)throw new Error("Unknown transformed variable: "+marker.name);
    const value=resolved.kind==="value"?resolved.value:"";
    const current=field("variable-transform:"+fields.length,parent,true);
    transform(marker.transform,current,undefined,value);emit(value);current.to=length;continue;
   }
   if(resolved?.kind==="value"){emit(resolved.value);continue;}
   if(resolved?.kind==="unset"){push(marker.children,parent,depth+1);continue;}
   const current=field("v:"+marker.name+":"+fields.length,parent);
   stack.push({finish:current});
   if(marker.children.length)push(marker.children,current.id,depth+1);else emit(marker.name);
   continue;
  }
  throw new Error("Unexpected snippet render node");
 }
 if(fields.some(value=>!value.derived)&&!fields.some(value=>value.final&&!value.derived))field("t:0",null,false,true);
 const editable=[...new Set(fields.filter(value=>!value.derived).map(value=>value.group))];
 const navigation=editable.filter(id=>id!=="t:0").sort((a,b)=>{
  if(a.startsWith("t:")&&b.startsWith("t:"))return Number(a.slice(2))-Number(b.slice(2));
  if(a.startsWith("t:"))return -1;if(b.startsWith("t:"))return 1;return 0;
 });
 if(editable.includes("t:0"))navigation.push("t:0");
 return {schemaVersion:1,parserIdentity:snippetParserIdentity,text:chunks.join(""),fields,navigation,transforms,needsTransformEvaluation:transforms.length>0};
}
