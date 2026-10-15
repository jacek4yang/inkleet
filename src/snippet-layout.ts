import type {EditorState} from "@codemirror/state";
import {snippetLimits,SnippetLimitError} from "./snippet-budget.ts";

import {validatePreparedSnippet} from "./snippet-validation.ts";
import type {PreparedSnippet} from "./snippet-prepare.ts";
/** CodeMirror positions use logical LF, even when an incoming edit uses CRLF. */
export function normalizeSnippetEol(prepared:PreparedSnippet):PreparedSnippet{
 const original=validatePreparedSnippet(prepared),text=original.text;
 if(!text.includes("\r")){
  if(!original.fields.some(f=>f.choices?.some(value=>value.includes("\r"))))return original;
  return validatePreparedSnippet({...original,fields:original.fields.map(f=>({...f,choices:f.choices?.map(value=>value.replace(/\r\n?/g,"\n"))}))});
 }
 const offsets=new Uint32Array(text.length+1),chunks:string[]=[];
 let length=0;
 for(let i=0;i<text.length;i++){
  offsets[i]=length;
  if(text.charCodeAt(i)===13){
   chunks.push("\n");length++;
   if(text.charCodeAt(i+1)===10){offsets[++i]=length;}
  }else{chunks.push(text[i]);length++;}
  offsets[i+1]=length;
 }
 const fields=original.fields.map(f=>({...f,from:offsets[f.from],to:offsets[f.to],choices:f.choices?.map(value=>value.replace(/\r\n?/g,"\n"))}));
 return validatePreparedSnippet({...original,text:chunks.join(""),fields});
}

export type SnippetLayout={prepared:PreparedSnippet;mode:1|2;indent:string};
/** Raw-input-only layout stage. The acceptance owner must not re-layout result.prepared. */
export function layoutSnippet(prepared:PreparedSnippet,state:EditorState,position:number,mode:1|2=1):SnippetLayout{
 if(mode!==1&&mode!==2)throw new SnippetLimitError("Unsupported snippet indentation mode");
 if(!Number.isSafeInteger(position)||position<0||position>state.doc.length)throw new SnippetLimitError("Invalid snippet insertion position");
 if(position>0&&position<state.doc.length){const pair=state.doc.sliceString(position-1,position+1);if(/[\uD800-\uDBFF]/.test(pair[0])&&/[\uDC00-\uDFFF]/.test(pair[1]))throw new SnippetLimitError("Invalid snippet UTF16 boundary");}
 const normalized=normalizeSnippetEol(prepared);
 if(mode===1)return {prepared:normalized,mode,indent:""};
 const line=state.doc.lineAt(position);
 if(position-line.from>snippetLimits.output)throw new SnippetLimitError("Snippet indentation context limit");
 const prefix=state.doc.sliceString(line.from,position),indent=/^[ \t]*/.exec(prefix)![0];
 if(normalized.transforms.length)throw new SnippetLimitError("Derived snippet indentation is not supported yet");
 const starts:number[]=[];
 for(let i=0;i<normalized.text.length;i++)if(normalized.text.charCodeAt(i)===10)starts.push(i+1);
 const count=(position:number)=>{
  let low=0,high=starts.length;
  while(low<high){const mid=(low+high)>>>1;if(starts[mid]<=position)low=mid+1;else high=mid;}
  return low;
 };
 let work=normalized.text.length;
 for(const field of normalized.fields){
  work+=field.to-field.from;if(work>snippetLimits.work)throw new SnippetLimitError("Snippet indentation work limit");
  if(count(field.to)>count(field.from)||field.choices?.some(choice=>choice.includes("\n")))throw new SnippetLimitError("Multiline parameter indentation is not supported yet");
 }
 const expanded=normalized.text.length+starts.length*indent.length;
 if(expanded>snippetLimits.output||expanded+normalized.text.length>snippetLimits.copies)throw new SnippetLimitError("Snippet indentation output limit");
 const map=(position:number)=>position+count(position)*indent.length;
 const result=validatePreparedSnippet({...normalized,text:normalized.text.replace(/\n/g,"\n"+indent),fields:normalized.fields.map(f=>({...f,from:map(f.from),to:map(f.to)}))});
 return {prepared:result,mode,indent};
}
