export type Result=Record<string,unknown>;
const verdicts:Record<string,string>={"Accepted":"通过","Wrong Answer":"答案错误","Compile Error":"编译错误","Runtime Error":"运行错误","Time Limit Exceeded":"超出时间限制","Memory Limit Exceeded":"超出内存限制","Output Limit Exceeded":"超出输出限制","Internal Error":"评测服务错误"};
export function readable(value:unknown):string{
 if(typeof value==="string")return value;
 if(Array.isArray(value))return value.map(item=>typeof item==="string"?item:JSON.stringify(item)).join("\n");
 return JSON.stringify(value,null,2)??"";
}
export function present(value:unknown){return value!==null&&value!==undefined;}
export function resultSummary(result:Result,submission:boolean){
 const status=typeof result.status_msg==="string"?result.status_msg:"";
 const accepted=submission&&status==="Accepted";
 const verdict=!submission&&status==="Accepted"?"运行完成":(verdicts[status]??status)||"评测已结束";
 const runtime=result.status_runtime??result.display_runtime;
 const memory=result.status_memory??result.display_memory;
 return {verdict,accepted,runtime:present(runtime)&&String(runtime)!=="N/A"?String(runtime)+(/^[\d.]+$/.test(String(runtime))?" ms":""):null,memory:present(memory)?String(memory):null};
}
