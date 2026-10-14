export type LocalCase={id:string;name:string;input:string};
export function parameterNames(metadata:string):string[]{
 try{const value=JSON.parse(metadata);if(value.systemdesign||!Array.isArray(value.params)||value.params.length>32)return [];
 return value.params.map((p:unknown,i:number)=>{const name=(p as {name?:unknown})?.name;return typeof name==="string"&&name.length<=80?name:"参数 "+(i+1);});}catch{return [];}
}
export function seedCases(sample:string,examples:string,names:string[]):LocalCase[]{
 const raw=(examples.trim()?examples:sample).replace(/\r\n?/g,"\n"),lines=raw.split("\n").filter(x=>x.trim());
 if(names.length&&lines.length&&lines.length%names.length===0&&lines.length/names.length<=64){
  try{lines.forEach(line=>JSON.parse(line));return Array.from({length:lines.length/names.length},(_,i)=>({id:"example-"+i,name:"用例 "+(i+1),input:lines.slice(i*names.length,(i+1)*names.length).join("\n")}));}catch{}
 }
 return [{id:"example-0",name:"用例 1",input:sample||raw}];
}
export function validateCases(value:unknown):{cases:LocalCase[];selected:string}{
 const v=value as {version?:unknown;cases?:unknown;selected?:unknown};
 if(v?.version!==1||!Array.isArray(v.cases)||!v.cases.length||v.cases.length>64||typeof v.selected!=="string")throw Error("测试用例记录无效，原记录已保留");
 const ids=new Set<string>();let total=0;
 for(const c of v.cases){if(!c||typeof c.id!=="string"||c.id.length>80||ids.has(c.id)||typeof c.name!=="string"||!c.name.trim()||c.name.length>80||typeof c.input!=="string"||(total+=c.input.length)>2*1024*1024)throw Error("测试用例记录无效，原记录已保留");ids.add(c.id);}
 if(!ids.has(v.selected))throw Error("选中的测试用例不存在");
 return {cases:v.cases,selected:v.selected};
}
export function inputParts(input:string,names:string[]):string[]|null{
 const lines=input.replace(/\r\n?/g,"\n").split("\n");
 return names.length&&lines.length===names.length?lines:null;
}
export type DisplayResult={caseNumber:number;value:string;error:string;raw:boolean};
// Locate exact top-level value bytes after validation. Never round large integer outputs.
export function displayResult(raw:string,index:number):DisplayResult{
 const fallback={caseNumber:index+1,value:raw,error:"",raw:true};
 try{
  const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||typeof parsed.ok!=="boolean")return fallback;
  const number=Number.isSafeInteger(parsed.case)&&parsed.case>0?parsed.case:index+1;
  if(!parsed.ok)return {caseNumber:number,value:"",error:typeof parsed.error==="string"?parsed.error:"执行失败",raw:false};
  let i=raw.indexOf("{")+1,output:string|undefined;
  while(i<raw.length){
   while(/[\s,]/.test(raw[i]??"")&&i<raw.length)i++;
   if(raw[i]!== '"')break;
   const keyStart=i++;let escaped=false;
   for(;i<raw.length;i++){const c=raw[i];if(!escaped&&c==='"'){i++;break;}if(c==="\\"&&!escaped)escaped=true;else escaped=false;}
   const key=JSON.parse(raw.slice(keyStart,i));while(/\s/.test(raw[i]??"")&&i<raw.length)i++;
   if(raw[i++]!==":")return fallback;
   while(/\s/.test(raw[i]??"")&&i<raw.length)i++;
   const start=i;let depth=0,quoted=false;escaped=false;
   for(;i<raw.length;i++){const c=raw[i];if(quoted){if(!escaped&&c==='"')quoted=false;if(c==="\\"&&!escaped)escaped=true;else escaped=false;continue;}if(c==='"'){quoted=true;continue;}if(c==="["||c==="{")depth++;else if(c==="]"||c==="}"){if(depth===0)break;depth--;}else if(c===","&&depth===0)break;}
   if(key==="value")output=raw.slice(start,i).trim();
   if(raw[i]==="}")break;
  }
  return output===undefined?fallback:{caseNumber:number,value:output,error:"",raw:false};
 }catch{return fallback;}
}

export function compactCaseValue(value:string):string{
 try{JSON.parse(value);}catch{return value;}
 let out="",quoted=false,escaped=false;
 for(const c of value){if(quoted){out+=c;if(!escaped&&c==='"')quoted=false;if(c==="\\"&&!escaped)escaped=true;else escaped=false;}
 else if(c==='"'){quoted=true;out+=c;}else if(!/\s/.test(c))out+=c;}
 return out;
}
