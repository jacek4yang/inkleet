// Exact JSON structural comparison, not a LeetCode judging policy.
// Numbers remain decimal tokens; arrays retain order; duplicate object keys are rejected.
export type Expectation={mode:"exact-json";target:{kind:"return"}|{kind:"argument";index:number};value:string};
export function validateExpectation(value:unknown):Expectation|null{
 if(value===undefined||value===null)return null;
 const e=value as Partial<Expectation>,target=e.target;
 if(e.mode!=="exact-json"||typeof e.value!=="string"||e.value.length>65536||!target||
   (target.kind!=="return"&&(target.kind!=="argument"||!Number.isSafeInteger(target.index)||target.index<0||target.index>=32)))throw Error("预期结果记录无效");
 return {mode:"exact-json",target:target.kind==="return"?{kind:"return"}:{kind:"argument",index:target.index},value:e.value};
}
function canonicalValues(text:string,multiple:boolean):string[]{
 if(text.length>1024*1024)throw Error("比较数据超过大小限制");
 let at=0,nodes=0;
 const space=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]))at++;};
 const fail=():never=>{throw Error("请输入有效 JSON；对象键不能重复");};
 function string():string{
  const start=at++;let escaped=false;
  for(;at<text.length;at++){
   const c=text[at];
   if(!escaped&&c==='"'){at++;return JSON.parse(text.slice(start,at)) as string;}
   if(c==="\\"&&!escaped)escaped=true;else escaped=false;
  }
  return fail();
 }
 function number():string{
  const match=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;match.lastIndex=at;
  const found=match.exec(text);if(!found)return fail();at=match.lastIndex;
  const token=found[0],parts=token.toLowerCase().split("e"),fraction=parts[0].split(".")[1]?.length??0;
  const exponentText=parts[1]??"0";
  // A bound on exponent digits prevents oversized integer work; no zero expansion.
  if(exponentText.replace(/^[+-]/,"").length>7)throw Error("数值指数超过比较范围");
  let exponent=Number(exponentText)-fraction;
  if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>1000000)throw Error("数值指数超过比较范围");
  let digits=parts[0].replace(/^-/,"").replace(".","").replace(/^0+/,"");
  if(!digits)return "n0";
  const trimmed=digits.replace(/0+$/,"");exponent+=digits.length-trimmed.length;digits=trimmed;
  return "n"+(token.startsWith("-")?"-":"")+digits+"e"+exponent;
 }
 function value(depth:number):string{
  if(depth>64||++nodes>10000)throw Error("比较数据嵌套或节点数超过限制");
  space();const c=text[at];
  if(c==='"')return "s"+JSON.stringify(string());
  if(c==="["){
   at++;space();const values:string[]=[];
   if(text[at]==="]"){at++;return "a[]";}
   while(at<text.length){values.push(value(depth+1));space();if(text[at]==="]"){at++;return "a["+values.join(",")+"]";}if(text[at++]!==",")return fail();}
   return fail();
  }
  if(c==="{"){
   at++;space();const entries=new Map<string,string>();
   if(text[at]==="}"){at++;return "o{}";}
   while(at<text.length){
    space();if(text[at]!=='"')return fail();const key=string();if(entries.has(key))return fail();
    space();if(text[at++]!==":")return fail();entries.set(key,value(depth+1));space();
    if(text[at]==="}"){at++;return "o{"+[...entries].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>JSON.stringify(key)+":"+v).join(",")+"}";}
    if(text[at++]!==",")return fail();
   }
   return fail();
  }
  for(const literal of ["true","false","null"]){if(text.startsWith(literal,at)){at+=literal.length;return literal;}}
  if(c==="-"||(c>="0"&&c<="9"))return number();
  return fail();
 }
 const values=[value(0)];space();
 if(multiple){while(at<text.length){values.push(value(0));space();}}
 if(at!==text.length)return fail();return values;
}
export function canonicalJson(text:string):string{return canonicalValues(text,false)[0];}
export function invocationCount(input:string,parameterCount:number):number{
 if(!Number.isSafeInteger(parameterCount)||parameterCount<1||parameterCount>32)throw Error("函数参数信息不可用");
 const values=canonicalValues(input,true).length;
 if(values%parameterCount!==0||values/parameterCount>100)throw Error("用例参数数量不匹配或超过限制");
 return values/parameterCount;
}
export function compareJson(actual:string,expected:string):"match"|"mismatch"{
 return canonicalJson(actual)===canonicalJson(expected)?"match":"mismatch";
}
