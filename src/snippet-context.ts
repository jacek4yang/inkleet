
import type {EditorState} from "@codemirror/state";
import {snippetLimits,SnippetLimitError} from "./snippet-budget.ts";
import type {VariableValue} from "./snippet-prepare.ts";
import {validateSnippetVariables} from "./snippet-validation.ts";
/** Capture only document-owned context. No filesystem, clipboard or network reads. */
export function snippetVariables(state:EditorState,position:number,uri?:string):Record<string,VariableValue>{
 if(!Number.isSafeInteger(position)||position<0||position>state.doc.length||state.selection.ranges.length!==1)throw new SnippetLimitError("Invalid snippet context");
 const line=state.doc.lineAt(position),selection=state.selection.main;
 if(line.length>snippetLimits.output||selection.to-selection.from>snippetLimits.output)throw new SnippetLimitError("Snippet context limit");
 const values:Record<string,VariableValue>=Object.create(null);
 const value=(name:string,text:string)=>{values[name]={kind:"value",value:text};};
 const unset=(name:string)=>{values[name]={kind:"unset"};};
 if(selection.empty)unset("TM_SELECTED_TEXT");else value("TM_SELECTED_TEXT",state.doc.sliceString(selection.from,selection.to));
 value("TM_CURRENT_LINE",line.text);
 const word=state.wordAt(position);
 if(word)value("TM_CURRENT_WORD",state.doc.sliceString(word.from,word.to));else unset("TM_CURRENT_WORD");
 value("TM_LINE_INDEX",String(line.number-1));value("TM_LINE_NUMBER",String(line.number));
 for(const name of ["TM_FILENAME","TM_FILENAME_BASE","TM_DIRECTORY","TM_FILEPATH"])unset(name);
 if(uri!==undefined){
  if(uri.length>snippetLimits.output)throw new SnippetLimitError("Snippet URI limit");
  let path:string|null=null;
  try{
   const parsed=new URL(uri);
   if(parsed.protocol==="file:"&&!parsed.search&&!parsed.hash&&!parsed.username&&!parsed.password){
    path=decodeURIComponent(parsed.pathname);
    if(path.includes("\0"))path=null;
    else if(parsed.hostname&&parsed.hostname!=="localhost")path="//"+parsed.hostname+path;
    else if(/^\/[A-Za-z]:\//.test(path))path=path.slice(1);
   }
  }catch{/* Missing or malformed URI remains explicitly unset. */}
  if(path!==null){
   const slash=path.lastIndexOf("/"),filename=path.slice(slash+1),dot=filename.lastIndexOf(".");
   if(filename){
    const windows=/^[A-Za-z]:\//.test(path)||path.startsWith("//");
    const native=(text:string)=>windows?text.replaceAll("/","\\"):text;
    value("TM_FILENAME",filename);value("TM_FILENAME_BASE",dot>0?filename.slice(0,dot):filename);
    value("TM_DIRECTORY",native(slash===0?"/":slash===2&&/^[A-Za-z]:/.test(path)?path.slice(0,3):path.slice(0,slash)));
    value("TM_FILEPATH",native(path));
   }
  }
 }
 return validateSnippetVariables(values);
}
