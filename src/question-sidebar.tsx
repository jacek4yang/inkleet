import React, { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Icon, IconButton } from "./icons";
import { readQuestion, type RemoteQuestion, type QuestionList } from "./catalogue";
type Recent = { id: string; number: string; title: string; official?: RemoteQuestion };
type Query = { keyword: string; difficulty: string; status: string; offset: number };
const difficulties: Record<string,string> = { Easy:"简单", Medium:"中等", Hard:"困难" };
export function QuestionSidebar({ account, recent, selected, onSelectRecent, onChoose }: {
  account: string | null; recent: Recent[]; selected: string; onSelectRecent: (id:string) => void;
  onChoose: (question: RemoteQuestion, warning?: string | null, fromCache?: boolean) => void;
}) {
  const [mode,setMode] = useState<"catalogue" | "recent">("catalogue");
  const [input,setInput] = useState("");
  const [query,setQuery] = useState<Query>({ keyword:"", difficulty:"", status:"", offset:0 });
  const [retry,setRetry] = useState(0);
  const [response,setResponse] = useState<{ account:string|null; query:Query; data:QuestionList } | null>(null);
  const [loading,setLoading] = useState(false), [opening,setOpening] = useState<string|null>(null);
  const [failure,setFailure] = useState<{ account:string|null; text:string } | null>(null);
  const requests = useRef(0), opens = useRef(0), openingGuard = useRef(false), owner = useRef(account);
  owner.current = account;
  useEffect(() => {
    const token = ++requests.current;
    ++opens.current; openingGuard.current = false; setOpening(null); setFailure(null);
    if (!isTauri() || mode !== "catalogue") { setLoading(false); return; }
    setLoading(true);
    const effective = { ...query, status: account ? query.status : "" };
    void invoke<QuestionList>("search_questions", { ...effective, account }).then(data => {
      if (token !== requests.current || owner.current !== account) return;
      if (!Array.isArray(data.questions) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error("题库响应格式无效");
      setResponse({ account, query, data });
    }).catch(error => {
      if (token === requests.current && owner.current === account) setFailure({ account, text:String(error) });
    }).finally(() => { if (token === requests.current) setLoading(false); });
    return () => { ++requests.current; ++opens.current; openingGuard.current = false; };
  }, [account,query,retry,mode]);
  // Account change synchronously hides the old status-bearing result, even before effects run.
  const data = response?.account === account && response.query === query ? response.data : null;
  const error = failure?.account === account ? failure.text : "";
  function filter(patch:Partial<Query>) { setQuery(current => ({ ...current,...patch,offset:0 })); }
  async function choose(slug:string) {
    if (openingGuard.current) return;
    openingGuard.current=true; setOpening(slug); setFailure(null);
    const token=++opens.current, accountAtStart=account;
    try {
      const result=await readQuestion(slug);
      if(token !== opens.current || owner.current !== accountAtStart) return;
      onChoose(result.question,result.cacheWarning,result.fromCache);
    } catch(error) {
      if(token === opens.current && owner.current === accountAtStart) setFailure({account:accountAtStart,text:String(error)});
    } finally {
      if(token === opens.current){openingGuard.current=false;setOpening(null);}
    }
  }
  return <aside className="sidebar question-sidebar" aria-label="题目导航">
    <div className="question-sidebar-heading"><div role="group" aria-label="题目列表">
      <button aria-pressed={mode==="catalogue"} onClick={()=>setMode("catalogue")}>题库</button>
      <button aria-pressed={mode==="recent"} onClick={()=>setMode("recent")}>最近</button>
    </div><IconButton icon="refresh" label="刷新题库" disabled={loading || !isTauri() || mode!=="catalogue"} onClick={()=>setRetry(n=>n+1)} /></div>
    {mode==="catalogue" ? <>
      <form className="question-search" onSubmit={event=>{event.preventDefault();filter({keyword:input.trim()});}}>
        <input aria-label="搜索题目" placeholder="题号或名称" maxLength={100} value={input} onChange={event=>setInput(event.target.value)} />
        <IconButton icon="search" label="搜索题库" type="submit" disabled={!isTauri()} />
      </form>
      <div className="question-filters">
        <select aria-label="题目难度" value={query.difficulty} onChange={event=>filter({difficulty:event.target.value})}>
          <option value="">全部难度</option><option value="EASY">简单</option><option value="MEDIUM">中等</option><option value="HARD">困难</option>
        </select>
        <select aria-label="完成状态" disabled={!account} title={account ? "力扣账户完成状态" : "登录后查看完成状态"} value={account ? query.status : ""} onChange={event=>filter({status:event.target.value})}>
          <option value="">全部状态</option><option value="NOT_STARTED">未开始</option><option value="AC">已通过</option><option value="TRIED">尝试过</option>
        </select>
      </div>
      <div className="question-list" aria-busy={loading || !!opening}>
        {loading && <p className="muted" role="status">加载中…</p>}
        {!isTauri() && <p className="muted">在客户端打开题库</p>}
        {!loading && data?.questions.map(q=><button key={q.titleSlug} data-slug={q.titleSlug} disabled={!!opening || q.paidOnly} aria-current={recent.find(p=>p.id===selected)?.official?.titleSlug===q.titleSlug ? "page" : undefined} onClick={()=>void choose(q.titleSlug)} title={q.paidOnly ? "会员题暂未开放" : q.titleCn || q.title}>
          <span className={"question-status "+(account && q.status==="AC" ? "accepted" : "")} title={account ? q.status==="AC" ? "已通过" : q.status==="TRIED" ? "尝试过" : q.status==="UNKNOWN" ? "完成状态暂不可用" : "未开始" : ""}>{account && q.status==="AC" ? <Icon name="check" /> : account && q.status==="TRIED" ? <Icon name="attempt" /> : account && q.status==="UNKNOWN" ? <Icon name="info" /> : null}</span>
          <span className="question-number">{q.frontendQuestionId}</span><span className="question-title">{q.titleCn||q.title}</span><span className={"question-difficulty "+q.difficulty}>{q.paidOnly ? <Icon name="lock" /> : difficulties[q.difficulty] ?? q.difficulty}</span>
        </button>)}
        {!loading && data && !data.questions.length && <p className="muted">没有匹配题目</p>}
        {error && <p role="alert" className="error">{error}</p>}
      </div>
      {data && <div className="question-pagination"><span>{data.total} 题</span><div><IconButton icon="previous" label="上一页题目" disabled={loading||query.offset===0} onClick={()=>setQuery(q=>({...q,offset:Math.max(0,q.offset-25)}))} /><span>{Math.floor(query.offset/25)+1}</span><IconButton icon="chevron" label="下一页题目" disabled={loading||!data.hasMore} onClick={()=>setQuery(q=>({...q,offset:q.offset+25}))} /></div></div>}
    </> : <div className="question-list">
      {recent.map(p=><button className="recent-question" key={p.id} data-problem={p.id} aria-current={p.id===selected?"page":undefined} onClick={()=>onSelectRecent(p.id)}><span className="question-number">{p.number}</span><span className="question-title">{p.title}</span></button>)}
      {!recent.length && <p className="muted">暂无最近题目</p>}
    </div>}
  </aside>;
}
