// Explicit local policies, never inferred from a problem or claimed as judge equivalence.
// Numbers remain decimal tokens; duplicate keys are rejected in every policy.
type Target={kind:"return"}|{kind:"argument";index:number};
export type ComparisonMode="exact-json"|"float-json"|"unordered-array";
export type Expectation={target:Target;value:string}&({mode:"exact-json"|"unordered-array"}|{mode:"float-json";absoluteTolerance:string;relativeTolerance:string});
export function validateExpectation(value:unknown):Expectation|null{
 if(value===undefined||value===null)return null;
 const e=value as Expectation,target=e.target;
 if(!["exact-json","float-json","unordered-array"].includes(e.mode)||typeof e.value!=="string"||e.value.length>65536||!target||
   (target.kind!=="return"&&(target.kind!=="argument"||!Number.isSafeInteger(target.index)||target.index<0||target.index>=32)))throw Error("预期结果记录无效");
 const common={target:target.kind==="return"?{kind:"return" as const}:{kind:"argument" as const,index:target.index},value:e.value};
 if(e.mode==="float-json"){
  if(typeof e.absoluteTolerance!=="string"||e.absoluteTolerance.length>64||typeof e.relativeTolerance!=="string"||e.relativeTolerance.length>64)throw Error("误差范围记录无效");
  return {...common,mode:e.mode,absoluteTolerance:e.absoluteTolerance,relativeTolerance:e.relativeTolerance};
 }
 return {...common,mode:e.mode};
}
type JsonNode={kind:"scalar";text:string}|{kind:"number";text:string}|{kind:"array";items:JsonNode[]}|{kind:"object";entries:[string,JsonNode][]};
function canonical(node:JsonNode):string{
 if(node.kind==="array")return "a["+node.items.map(canonical).join(",")+"]";
 if(node.kind==="object")return "o{"+node.entries.map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
 return node.text;
}
function parseValues(text:string,multiple:boolean):JsonNode[]{
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
 function value(depth:number):JsonNode{
  if(depth>64||++nodes>10000)throw Error("比较数据嵌套或节点数超过限制");
  space();const c=text[at];
  if(c==='"')return {kind:"scalar",text:"s"+JSON.stringify(string())};
  if(c==="["){
   at++;space();const values:JsonNode[]=[];
   if(text[at]==="]"){at++;return {kind:"array",items:[]};}
   while(at<text.length){values.push(value(depth+1));space();if(text[at]==="]"){at++;return {kind:"array",items:values};}if(text[at++]!==",")return fail();}
   return fail();
  }
  if(c==="{"){
   at++;space();const entries=new Map<string,JsonNode>();
   if(text[at]==="}"){at++;return {kind:"object",entries:[]};}
   while(at<text.length){
    space();if(text[at]!=='"')return fail();const key=string();if(entries.has(key))return fail();
    space();if(text[at++]!==":")return fail();entries.set(key,value(depth+1));space();
    if(text[at]==="}"){at++;return {kind:"object",entries:[...entries].sort(([a],[b])=>a<b?-1:a>b?1:0)};}
    if(text[at++]!==",")return fail();
   }
   return fail();
  }
  for(const literal of ["true","false","null"]){if(text.startsWith(literal,at)){at+=literal.length;return {kind:"scalar",text:literal};}}
  if(c==="-"||(c>="0"&&c<="9"))return {kind:"number",text:number()};
  return fail();
 }
 const values=[value(0)];space();
 if(multiple){while(at<text.length){values.push(value(0));space();}}
 if(at!==text.length)return fail();return values;
}
export function canonicalJson(text:string):string{return canonical(parseValues(text,false)[0]);}
export function invocationCount(input:string,parameterCount:number):number{
 if(!Number.isSafeInteger(parameterCount)||parameterCount<0||parameterCount>32)throw Error("函数参数信息不可用");
 if(new TextEncoder().encode(input).length>1024*1024)throw Error("运行输入超过 1 MiB");
 const noParameters=parameterCount===0;parameterCount=Math.max(1,parameterCount);
 let at=0,values=0;
 const number=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
 const fail=():never=>{throw Error("用例须为连续 JSON 值，每个参数一个值");};
 while(at<input.length){
  while(/[ \t\r\n]/.test(input[at]??"")&&at<input.length)at++;
  if(at===input.length)break;
  const start=at,c=input[at];
  if(c==="["||c==="{"){
   let depth=0,quoted=false,escaped=false;
   for(;at<input.length;at++){
    const ch=input[at];
    if(quoted){if(!escaped&&ch==='"')quoted=false;if(ch==="\\"&&!escaped)escaped=true;else escaped=false;continue;}
    if(ch==='"'){quoted=true;continue;}
    if(ch==="["||ch==="{"){if(++depth>128)throw Error("运行输入嵌套超过限制");}
    else if(ch==="]"||ch==="}"){if(--depth===0){at++;break;}}
   }
   if(depth!==0||quoted)return fail();
  }else if(c==='"'){
   at++;let escaped=false,closed=false;
   for(;at<input.length;at++){const ch=input[at];if(!escaped&&ch==='"'){at++;closed=true;break;}if(ch==="\\"&&!escaped)escaped=true;else escaped=false;}
   if(!closed)return fail();
  }else{
   const literal=["true","false","null"].find(value=>input.startsWith(value,at));
   if(literal)at+=literal.length;
   else{number.lastIndex=at;if(!number.exec(input))return fail();at=number.lastIndex;}
  }
  // Validation only: original input bytes are retained for the backend. Parsed
  // numeric values are never used for comparison, serialization or execution.
  try{const parsed=JSON.parse(input.slice(start,at));if(noParameters&&(!Array.isArray(parsed)||parsed.length))return fail();}catch{return fail();}
  if(++values>parameterCount*100)throw Error("一批运行最多 100 组函数调用");
 }
 if(!values||values%parameterCount!==0)throw Error("用例参数数量不匹配");
 return values/parameterCount;
}
export function compareJson(actual:string,expected:string):"match"|"mismatch"{
 return canonicalJson(actual)===canonicalJson(expected)?"match":"mismatch";
}

// Decimal integer arithmetic avoids rounding adjacent large integers into a false match.
// Float comparisons are intentionally narrower than exact JSON: finite decimals with
// <= 256 significant digits and normalized exponent in [-1024, 308]; out-of-range is uncomparable.
type Decimal={coefficient:bigint;exponent:number};
function decimal(node:JsonNode):Decimal{
 if(node.kind!=="number")throw Error("误差范围必须为非负十进制数");
 if(node.text==="n0")return {coefficient:0n,exponent:0};
 const match=/^n(-?\d+)e(-?\d+)$/.exec(node.text)!;
 if(match[1].replace("-","").length>256||(Number(match[2])< -1024||Number(match[2])>308)||!Number.isFinite(Number(match[1]+"e"+match[2])))throw Error("浮点比较数值超过范围");
 return {coefficient:BigInt(match[1]),exponent:Number(match[2])};
}
function tolerance(text:unknown):Decimal{
 if(typeof text!=="string"||text.length>64||!text.trim())throw Error("误差范围必须为非负十进制数");
 const result=decimal(parseValues(text,false)[0]);
 if(result.coefficient<0n)throw Error("误差范围不能为负数");return result;
}
const magnitude=(n:bigint)=>n<0n?-n:n;
function aligned(a:Decimal,b:Decimal):[bigint,bigint]{
 const exponent=Math.min(a.exponent,b.exponent);
 return [a.coefficient*10n**BigInt(a.exponent-exponent),b.coefficient*10n**BigInt(b.exponent-exponent)];
}
function le(a:Decimal,b:Decimal):boolean{const [x,y]=aligned(a,b);return x<=y;}
function numericClose(a:JsonNode,b:JsonNode,absolute:Decimal,relative:Decimal):boolean{
 const x=decimal(a),y=decimal(b),[left,right]=aligned(x,y);
 const difference={coefficient:magnitude(left-right),exponent:Math.min(x.exponent,y.exponent)};
 const ax={...x,coefficient:magnitude(x.coefficient)},ay={...y,coefficient:magnitude(y.coefficient)};
 const maximum=le(ax,ay)?ay:ax;
 const scaled={coefficient:relative.coefficient*maximum.coefficient,exponent:relative.exponent+maximum.exponent};
 return le(difference,absolute)||le(difference,scaled);
}
function close(a:JsonNode,b:JsonNode,absolute:Decimal,relative:Decimal):boolean{
 if(a.kind!==b.kind)return false;
 if(a.kind==="number"&&b.kind==="number")return numericClose(a,b,absolute,relative);
 if(a.kind==="array"&&b.kind==="array")return a.items.length===b.items.length&&a.items.every((v,i)=>close(v,b.items[i],absolute,relative));
 if(a.kind==="object"&&b.kind==="object")return a.entries.length===b.entries.length&&a.entries.every(([k,v],i)=>k===b.entries[i][0]&&close(v,b.entries[i][1],absolute,relative));
 return canonical(a)===canonical(b);
}
export function compareExpectation(actual:string,expectation:Expectation):"match"|"mismatch"{
 const e=validateExpectation(expectation)!;
 if(e.mode==="exact-json")return compareJson(actual,e.value);
 const a=parseValues(actual,false)[0],b=parseValues(e.value,false)[0];
 if(e.mode==="float-json")return close(a,b,tolerance(e.absoluteTolerance),tolerance(e.relativeTolerance))?"match":"mismatch";
 if(a.kind!=="array"||b.kind!=="array")throw Error("无序比较仅支持最外层数组");
 const left=a.items.map(canonical).sort(),right=b.items.map(canonical).sort();
 return left.length===right.length&&left.every((v,i)=>v===right[i])?"match":"mismatch";
}
