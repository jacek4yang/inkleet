import {validateExpectation,type Expectation} from "./case-expectations.ts";
export type LocalCase={id:string;name:string;input:string;expectation?:Expectation|null};
export function parameterNames(metadata:string):string[]{
 try{const value=JSON.parse(metadata);if(value.systemdesign||value.classname){return typeof value.classname==="string"&&value.constructor&&Array.isArray(value.constructor.params)&&Array.isArray(value.methods)?["操作","参数"]:[];}if(!Array.isArray(value.params)||value.params.length>32)return [];
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
 if((v?.version!==1&&v?.version!==2)||!Array.isArray(v.cases)||!v.cases.length||v.cases.length>64||typeof v.selected!=="string")throw Error("测试用例记录无效，原记录已保留");
 const ids=new Set<string>();let total=0;const cases:LocalCase[]=[];
 for(const c of v.cases){
  if(!c||typeof c.id!=="string"||!c.id||c.id.length>80||ids.has(c.id)||typeof c.name!=="string"||!c.name.trim()||c.name.length>80||typeof c.input!=="string")throw Error("测试用例记录无效，原记录已保留");
  const expectation=v.version===2?validateExpectation(c.expectation):null;
  total+=c.input.length+(expectation?.value.length??0);if(total>2*1024*1024)throw Error("测试用例超过大小限制，原记录已保留");
  ids.add(c.id);cases.push({id:c.id,name:c.name,input:c.input,expectation});
 }
 if(!ids.has(v.selected))throw Error("选中的测试用例不存在");
 return {cases,selected:v.selected};
}
export function inputParts(input:string,names:string[]):string[]|null{
 const lines=input.replace(/\r\n?/g,"\n").split("\n");
 return names.length&&lines.length===names.length?lines:null;
}
export type DisplayResult={caseNumber:number;value:string;error:string;raw:boolean;argumentsAfterCall?:{value:string;unavailable:boolean}[]};
// JSON.parse validates structure; values are sliced from original bytes to preserve integers.
function valueEnd(raw:string,start:number):number{
 let depth=0,quoted=false,escaped=false;
 for(let i=start;i<raw.length;i++){
  const c=raw[i];
  if(quoted){if(!escaped&&c==='"')quoted=false;if(c==="\\"&&!escaped)escaped=true;else escaped=false;continue;}
  if(c==='"'){quoted=true;continue;}
  if(c==="["||c==="{")depth++;
  else if(c==="]"||c==="}"){if(depth===0)return i;depth--;}
  else if(c===","&&depth===0)return i;
 }
 return raw.length;
}
function exactArray(raw:string):string[]{
 const values:string[]=[];let i=raw.indexOf("[")+1;
 while(i<raw.length){
  while(/\s/.test(raw[i]??"")&&i<raw.length)i++;
  if(raw[i]==="]")break;
  const end=valueEnd(raw,i);values.push(raw.slice(i,end).trim());i=end;
  if(raw[i]===",")i++;else break;
 }
 return values;
}
/** Protocol identity is independent of the bounded expected-value comparator. */
export function resultCaseNumber(raw:string):number|null{
 try{
  if(raw.length>1024*1024)return null;
  const parsed=JSON.parse(raw);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||!Object.hasOwn(parsed,"ok")||!Object.hasOwn(parsed,"case")||typeof parsed.ok!=="boolean"||!Number.isSafeInteger(parsed.case)||parsed.case<1||parsed.case>100)return null;
  if(parsed.ok&&!Object.hasOwn(parsed,"value")||!parsed.ok&&(!Object.hasOwn(parsed,"error")||typeof parsed.error!=="string"))return null;
  let i=raw.indexOf("{")+1;const keys=new Set<string>();
  while(i<raw.length){
   while(/[\s,]/.test(raw[i]??"")&&i<raw.length)i++;
   if(raw[i]==="}")break;
   if(raw[i]!=='"')return null;
   const start=i++;let escaped=false;
   for(;i<raw.length;i++){const c=raw[i];if(!escaped&&c==='"'){i++;break;}if(c==="\\"&&!escaped)escaped=true;else escaped=false;}
   const key=JSON.parse(raw.slice(start,i));if(keys.has(key))return null;keys.add(key);
   while(/\s/.test(raw[i]??"")&&i<raw.length)i++;
   if(raw[i++]!==":")return null;
   while(/\s/.test(raw[i]??"")&&i<raw.length)i++;
   i=valueEnd(raw,i);if(raw[i]==="}")break;
  }
  return parsed.case;
 }catch{return null;}
}
export function displayResult(raw:string,index:number):DisplayResult{
 const fallback={caseNumber:index+1,value:raw,error:"",raw:true};
 try{
  const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||typeof parsed.ok!=="boolean")return fallback;
  const number=Number.isSafeInteger(parsed.case)&&parsed.case>0?parsed.case:index+1;
  if(!parsed.ok)return {caseNumber:number,value:"",error:typeof parsed.error==="string"&&parsed.error.trim()?parsed.error:"执行失败",raw:false};
  let i=raw.indexOf("{")+1,output:string|undefined,argumentsRaw:string|undefined;
  while(i<raw.length){
   while(/[\s,]/.test(raw[i]??"")&&i<raw.length)i++;
   if(raw[i]!== '"')break;
   const keyStart=i++;let escaped=false;
   for(;i<raw.length;i++){const c=raw[i];if(!escaped&&c==='"'){i++;break;}if(c==="\\"&&!escaped)escaped=true;else escaped=false;}
   const key=JSON.parse(raw.slice(keyStart,i));while(/\s/.test(raw[i]??"")&&i<raw.length)i++;
   if(raw[i++]!==":")return fallback;
   while(/\s/.test(raw[i]??"")&&i<raw.length)i++;
   const start=i;i=valueEnd(raw,i);
   if(key==="value")output=raw.slice(start,i).trim();
   if(key==="argumentsAfterCall")argumentsRaw=raw.slice(start,i).trim();
   if(raw[i]==="}")break;
  }
  if(output===undefined)return fallback;
  if(argumentsRaw===undefined)return {caseNumber:number,value:output,error:"",raw:false};
  if(!Array.isArray(parsed.argumentsAfterCall)||parsed.argumentsAfterCall.length>32)return fallback;
  const unavailable=parsed.argumentsUnavailable===undefined?[]:parsed.argumentsUnavailable;
  if(!Array.isArray(unavailable)||new Set(unavailable).size!==unavailable.length||unavailable.some(n=>!Number.isSafeInteger(n)||n<0||n>=parsed.argumentsAfterCall.length))return fallback;
  const values=exactArray(argumentsRaw);
  if(values.length!==parsed.argumentsAfterCall.length)return fallback;
  return {caseNumber:number,value:output,error:"",raw:false,argumentsAfterCall:values.map((value,index)=>({value,unavailable:unavailable.includes(index)}))};
 }catch{return fallback;}
}

export function compactCaseValue(value:string):string{
 try{JSON.parse(value);}catch{return value;}
 let out="",quoted=false,escaped=false;
 for(const c of value){if(quoted){out+=c;if(!escaped&&c==='"')quoted=false;if(c==="\\"&&!escaped)escaped=true;else escaped=false;}
 else if(c==='"'){quoted=true;out+=c;}else if(!/\s/.test(c))out+=c;}
 return out;
}

/** Append only missing official inputs. Existing cases and expectations are untouched. */
export function appendExampleCases(cases:LocalCase[],sample:string,examples:string,names:string[]):{cases:LocalCase[];added:number}{
 if(!sample.trim()&&!examples.trim())return {cases,added:0};
 const identity=(input:string)=>input.replace(/\r\n?/g,"\n").trim().split("\n").map(line=>compactCaseValue(line.trim())).filter(Boolean).join("\n");
 const known=new Set(cases.map(item=>identity(item.input))),ids=new Set(cases.map(item=>item.id));
 const additions:LocalCase[]=[];let serial=1;
 for(const item of seedCases(sample,examples,names)){
  const key=identity(item.input);if(!key||known.has(key))continue;
  while(ids.has("imported-example-"+serial))serial++;
  const id="imported-example-"+serial++;ids.add(id);known.add(key);
  additions.push({id,name:"题目示例 "+(serial-1),input:item.input});
 }
 if(!additions.length)return {cases,added:0};
 const next=[...cases,...additions];
 if(next.length>64||next.reduce((n,c)=>n+c.input.length+(c.expectation?.value.length??0),0)>2*1024*1024)throw Error("导入会超过用例大小或数量限制，未更改现有用例");
 return {cases:next,added:additions.length};
}
