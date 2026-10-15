
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
