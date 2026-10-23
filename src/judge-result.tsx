import React from "react";
import {readable,resultSummary,present,type Result} from "./judge-result-model";
export function JudgeResult({result,submission,serverId,input}:{result:Result;submission:boolean;serverId:string;input:string}){
 const summary=resultSummary(result,submission);
 const fields:[string,unknown][]=[
  ["错误",result.full_compile_error??result.compile_error??result.full_runtime_error??result.runtime_error],
  ["失败输入",submission?result.last_testcase:undefined],
  ["本次运行输入",submission?undefined:input],
  ["实际输出",submission?result.code_output:result.code_answer],
  ["预期输出",submission?result.expected_output:result.expected_code_answer??result.expected_code_output],
  ["标准输出",submission?result.std_output??result.stdout:result.std_output_list??result.code_output??result.std_output??result.stdout],
 ];
 const count=present(result.total_correct)&&present(result.total_testcases)?String(result.total_correct)+" / "+String(result.total_testcases):null;
 return <section className="judge-readable" aria-label="评测结果">
  <header><strong className={summary.accepted?"verdict accepted":"verdict"}>{summary.verdict}</strong><span className="judge-metrics">{count&&<span title="通过用例 / 总用例">{count}</span>}{summary.runtime&&<span title="耗时">{summary.runtime}</span>}{summary.memory&&<span title="内存">{summary.memory}</span>}</span></header>
  <div className="judge-comparison">{fields.filter(([,value])=>present(value)).map(([label,value])=><section key={label} className={label==="错误"?"judge-field judge-error":["失败输入","本次运行输入","标准输出"].includes(label)?"judge-field judge-wide":"judge-field"}><h4>{label}</h4><pre>{readable(value)}</pre></section>)}</div>
  {result.output_truncated===true&&<p className="judge-truncated">输出过长，已截断展示</p>}<details className="judge-raw"><summary>原始详情 · {serverId}</summary><pre>{JSON.stringify(result,null,2)}</pre></details>
 </section>;
}
