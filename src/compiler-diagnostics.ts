/** stderr is untrusted text, never a path or an instruction to open a file. */
export type CompilerDiagnostic = {file:string;line:number;column?:number;severity:"error"|"warning"|"note";message:string};
export type DiagnosticReport = {items:CompilerDiagnostic[];limited:boolean};
const files:Record<string,string>={cpp:"solution.cpp",c:"solution.c",rust:"solution.rs",golang:"solution.go",java:"Solution.java",python3:"solution.py"};
const MAX_TEXT=65536, MAX_LINES=2000, MAX_LINE=4096, MAX_ITEMS=50;
function positive(text:string|undefined):number|undefined{
 const n=Number(text);return Number.isSafeInteger(n)&&n>0&&n<=10000000?n:undefined;
}
export function parseCompilerDiagnostics(raw:string,language:string):DiagnosticReport{
 if(!files[language])return {items:[],limited:false};
 const lines=raw.slice(0,MAX_TEXT).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"").split(/\r?\n/);
 let limited=raw.length>MAX_TEXT||lines.length>MAX_LINES;
 const items:CompilerDiagnostic[]=[];
 let rust:{severity:CompilerDiagnostic["severity"];message:string}|null=null;
 for(let i=0;i<Math.min(lines.length,MAX_LINES);i++){
  const text=lines[i];if(text.length>MAX_LINE){limited=true;rust=null;continue;}
  let file:string|undefined,line:string|undefined,column:string|undefined,message:string|undefined,severity:CompilerDiagnostic["severity"]="error";
  if(language==="rust"){
   const heading=/^(error|warning|note)(?:\[[^\]\r\n]{1,40}\])?:\s+(.+)$/.exec(text);
   if(heading){rust={severity:heading[1] as CompilerDiagnostic["severity"],message:heading[2]};continue;}
   const location=/^\s*-->\s+(.+?):(\d+):(\d+)\s*$/.exec(text);
   if(rust&&location){[,file,line,column]=location;({message,severity}=rust);rust=null;}
   else if(!text.trim())rust=null;
  }else if(language==="python3"){
   const location=/^\s*File "([^"\r\n]+)", line (\d+)(?:, in .*)?$/.exec(text);
   if(location){
    for(let j=i+1;j<Math.min(i+5,lines.length);j++){
     if(lines[j].length>MAX_LINE){limited=true;break;}
     if(/^\s*File "/.test(lines[j]))break;
     const error=/^(SyntaxError|IndentationError|TabError):\s*(.*)$/.exec(lines[j]);
     if(error){[,file,line]=location;message=error[1]+": "+error[2];break;}
    }
   }
  }else{
   const location=/^(.+?):(\d+)(?::(\d+))?:\s*(?:(fatal error|error|warning|note):\s*)?(.+)$/.exec(text);
   if(location){
    // Go emits no severity prefix; other compilers must explicitly identify it.
    if(language!=="golang"&&!location[4])continue;
    [,file,line,column]=location;message=location[5];severity=location[4]==="warning"?"warning":location[4]==="note"?"note":"error";
   }
  }
  const row=positive(line),col=positive(column);
  if(file&&row&&message&&(!column||col)){
   if(items.length===MAX_ITEMS){limited=true;break;}
   items.push({file,line:row,...(col?{column:col}:{}),severity,message});
  }
 }
 return {items,limited};
}
/** Basename matching an arbitrary absolute path is NOT proof of ownership.
 * Without an authenticated run root, only the known relative virtual filename
 * is eligible. No filesystem access or URI navigation is ever performed. */
export function ownedDiagnosticLine(item:CompilerDiagnostic,language:string,source:string):number|null{
 const name=files[language];
 if(!name||(item.file!==name&&item.file!=="./"+name))return null;
 if(!Number.isSafeInteger(item.line)||item.line<1||item.line>source.split("\n").length)return null;
 return item.line;
}
export function diagnosticExcerpt(source:string,line:number):{line:number;text:string;active:boolean}[]{
 const lines=source.split("\n");
 if(!Number.isSafeInteger(line)||line<1||line>lines.length)return [];
 const start=Math.max(1,line-1),end=Math.min(lines.length,line+1);
 return lines.slice(start-1,end).map((text,index)=>({line:start+index,text,active:start+index===line}));
}
