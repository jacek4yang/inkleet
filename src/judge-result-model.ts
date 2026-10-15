export type Result=Record<string,unknown>;
const verdicts:Record<string,string>={"Accepted":"通过","Wrong Answer":"答案错误","Compile Error":"编译错误","Runtime Error":"运行错误","Time Limit Exceeded":"超出时间限制","Memory Limit Exceeded":"超出内存限制","Output Limit Exceeded":"超出输出限制","Internal Error":"评测服务错误","Unknown Error":"未知评测错误"};
// Protocol fallback reference: skygragon/leetcode-cli 5245886992ceb64bfb322256b2bdc24184b36d76, lib/helper.js:108-120.
const statusCodes:Record<number,string>={10:"Accepted",11:"Wrong Answer",12:"Memory Limit Exceeded",13:"Output Limit Exceeded",14:"Time Limit Exceeded",15:"Runtime Error",16:"Internal Error",20:"Compile Error",21:"Unknown Error"};
const knownVerdict=(status:string)=>Object.hasOwn(verdicts,status)?verdicts[status]:undefined;
export function readable(value:unknown):string{
 if(typeof value==="string")return value;
 if(Array.isArray(value))return value.map(item=>typeof item==="string"?item:JSON.stringify(item)).join("\n");
 return JSON.stringify(value,null,2)??"";
}
export function present(value:unknown){return value!==null&&value!==undefined;}
export function resultSummary(result:Result,submission:boolean){
 const message=typeof result.status_msg==="string"?result.status_msg.trim():"";
 const code=typeof result.status_code==="number"&&Number.isSafeInteger(result.status_code)&&result.status_code>0?result.status_code:null;
 const coded=code===null||!Object.hasOwn(statusCodes,code)?"":statusCodes[code];
 const conflicting=!!message&&!!coded&&knownVerdict(message)!==undefined&&message!==coded;
 const status=conflicting?"":message||coded;
 const accepted=submission&&status==="Accepted";
 const comparison=typeof result.compare_result==="string"&&/^[01]+$/.test(result.compare_result)?result.compare_result:null;
 const failedTest=result.correct_answer===false||(comparison!==null&&comparison.includes("0"));
 const passedTest=!failedTest&&(result.correct_answer===true||(comparison!==null&&/^1+$/.test(comparison)));
 const verdict=conflicting?"评测状态不一致":!submission&&status==="Accepted"?(failedTest?"测试答案错误":passedTest?"测试通过":"运行完成"):(knownVerdict(status)??status)||(code===null?"评测已结束":"未知评测状态（"+code+"）");
 const runtime=result.status_runtime??result.display_runtime;
 const memory=result.status_memory??result.display_memory;
 return {verdict,accepted,runtime:present(runtime)&&String(runtime)!=="N/A"?String(runtime)+(/^[\d.]+$/.test(String(runtime))?" ms":""):null,memory:present(memory)?String(memory):null};
}
