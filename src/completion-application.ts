
import type {Text} from "@codemirror/state";
import {snippetLimits} from "./snippet-budget.ts";
export type CompletionEdit={from:number;to:number;insert:string};
export type CompletionApplication={primary:CompletionEdit;additional:CompletionEdit[];format:1|2;mode:1|2};
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==="object"&&!Array.isArray(value);
function boundary(doc:Text,pos:number){if(pos===0||pos===doc.length)return true;const pair=doc.sliceString(pos-1,pos+1);return !(/[\uD800-\uDBFF]/.test(pair[0])&&/[\uDC00-\uDFFF]/.test(pair[1]));}
function offset(doc:Text,value:unknown):number|null{
 if(!object(value)||!Number.isSafeInteger(value.line)||!Number.isSafeInteger(value.character)||value.line<0||value.line>=doc.lines||value.character<0)return null;
 const line=doc.line(value.line+1);if(value.character>line.length)return null;
 const pos=line.from+value.character;return boundary(doc,pos)?pos:null;
}
function range(doc:Text,value:unknown){
 if(!object(value))return null;const from=offset(doc,value.start),to=offset(doc,value.end);
 return from!==null&&to!==null&&from<=to?{from,to}:null;
}
/** Shape/budget admission only; never parses source or applies an edit. */
export function completionApplication(doc:Text,item:unknown,from:number,to:number,selection?:{from:number;to:number},defaultMode:unknown=1):CompletionApplication|null{
 if(defaultMode!==1&&defaultMode!==2)return null;
 if(!object(item)||![from,to].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=doc.length)||from>to||!boundary(doc,from)||!boundary(doc,to))return null;
 if(selection&&(![selection.from,selection.to].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=doc.length)||selection.from>selection.to||!boundary(doc,selection.from)||!boundary(doc,selection.to)))return null;
 const format=item.insertTextFormat===undefined?1:item.insertTextFormat,mode=item.insertTextMode===undefined?defaultMode:item.insertTextMode;
 if(format!==1&&format!==2||mode!==1&&mode!==2)return null;
 if(item.textEdit!==undefined&&!object(item.textEdit))return null;
 const edit=item.textEdit;
 let span=edit?range(doc,edit.range):selection&&selection.from!==selection.to?{from:selection.from,to:selection.to}:{from,to};
 if(edit&&edit.range===undefined){
  const insert=range(doc,edit.insert),replace=range(doc,edit.replace);
  if(!insert||!replace||insert.from!==replace.from||insert.to>replace.to||insert.from>to||insert.to<to)return null;
  span=replace;
 }else if(edit&&(edit.insert!==undefined||edit.replace!==undefined))return null;
 const source=edit?edit.newText:item.insertText===undefined?item.label:item.insertText;
 if(!span||typeof source!=="string"||source.length>snippetLimits.source||span.from>to||span.to<to||doc.lineAt(span.from).number!==doc.lineAt(span.to).number)return null;
 if(selection&&(span.from>selection.from||span.to<selection.to))return null;
 const primary={...span,insert:source},additional:CompletionEdit[]=[];
 let units=source.length;
 if(item.additionalTextEdits!==undefined){
  if(!Array.isArray(item.additionalTextEdits)||item.additionalTextEdits.length>20)return null;
  for(const value of item.additionalTextEdits){
   const span=object(value)?range(doc,value.range):null;
   if(!span||typeof value.newText!=="string"||value.newText.length>snippetLimits.output)return null;
   units+=value.newText.length;if(units>snippetLimits.copies)return null;
   additional.push({...span,insert:value.newText.replace(/\r\n?/g,"\n")});
  }
 }
 const edits=[primary,...additional].sort((a,b)=>a.from-b.from||a.to-b.to||Number(a===primary)-Number(b===primary));
 for(let i=1;i<edits.length;i++){
  const a=edits[i-1],b=edits[i];
  if(b.from<a.to||a.from===a.to&&b.from===b.to&&a.from===b.from)return null;
 }
 return {primary,additional,format,mode};
}
export function completionTextChanges(application:CompletionApplication,insert:string){
 if(typeof insert!=="string"||insert.length>snippetLimits.output)return null;
 const main={...application.primary,insert:insert.replace(/\r\n?/g,"\n")},changes=[main,...application.additional];
 if(changes.reduce((sum,edit)=>sum+edit.insert.length,0)>snippetLimits.copies)return null;
 changes.sort((a,b)=>a.from-b.from||a.to-b.to||Number(a===main)-Number(b===main));
 return {changes,anchor:main.from+main.insert.length+changes.filter(c=>c!==main&&(c.from<main.from||c.from===main.from&&c.to===c.from)).reduce((sum,c)=>sum+c.insert.length-(c.to-c.from),0)};
}
export function plainCompletionChanges(doc:Text,item:unknown,from:number,to:number){
 const application=completionApplication(doc,item,from,to);if(!application||application.format!==1||application.mode!==1)return null;
 return completionTextChanges(application,application.primary.insert);
}
