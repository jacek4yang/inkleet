import React, { useEffect, useRef, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";

export type RemoteQuestion = {
  questionId: string; questionFrontendId: string; title: string; titleSlug: string;
  translatedTitle: string | null; content: string | null; translatedContent: string | null;
  isPaidOnly: boolean; difficulty: string; sampleTestCase: string | null;
  exampleTestcases: string | null; metaData: string | null;
  codeSnippets: { langSlug: string; code: string }[] | null;
};
type Summary = {
  frontendQuestionId: string; title: string; titleCn: string | null;
  titleSlug: string; difficulty: string; paidOnly: boolean;
};
type Result = { questions: Summary[]; total: number; hasMore: boolean };

// 题面是不可信远程 HTML。仅保留排版，无脚本、表单、链接导航、远程资源或自定义元素。
export function QuestionStatement({ question }: { question: RemoteQuestion }) {
  const raw = question.translatedContent || question.content || "";
  const clean = useMemo(() => DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ["p", "div", "span", "strong", "b", "em", "i", "u", "s", "br", "hr",
      "pre", "code", "ul", "ol", "li", "h2", "h3", "h4", "blockquote",
      "table", "thead", "tbody", "tr", "td", "th", "sup", "sub"],
    ALLOWED_ATTR: ["colspan", "rowspan"],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  }), [raw]);
  return <>
    <p className="eyebrow">力扣中国站 · {question.questionFrontendId} <span className="badge">{question.difficulty}</span></p>
    <h1>{question.translatedTitle || question.title}</h1>
    {clean ? <div className="question-content" dangerouslySetInnerHTML={{ __html: clean }} /> :
      <p className="error">{question.isPaidOnly ? "此题需要会员权限；当前只读接入不访问会员题面。" : "题面暂不可用，请稍后重试。"}</p>}
    {/<(?:img|svg|math)\b/i.test(raw) && <p className="muted">此题包含图示或公式；当前预览尚未呈现这些内容，请对照官方题面。</p>}
    <p className="question-source">题目来源：leetcode.cn/problems/{question.titleSlug}/</p>
  </>;
}

export function Catalogue({ onChoose, onClose }: {
  onChoose: (question: RemoteQuestion) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const [keyword, setKeyword] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [offset, setOffset] = useState(0);
  const [lastKeyword, setLastKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    return () => { generation.current++; };
  }, []);
  function close() { generation.current++; onClose(); }
  async function search(next = 0) {
    const token = ++generation.current;
    const term = next === 0 ? keyword : lastKeyword;
    setBusy(true); setError("");
    try {
      const data = await invoke<Result>("search_questions", { keyword: term, offset: next });
      if (token !== generation.current) return;
      setResult(data); setOffset(next); setLastKeyword(term);
    } catch (e) { if (token === generation.current) setError(String(e)); }
    finally { if (token === generation.current) setBusy(false); }
  }
  async function choose(slug: string) {
    const token = ++generation.current;
    setBusy(true); setError("");
    try {
      const data = await invoke<RemoteQuestion>("get_question", { slug });
      if (token !== generation.current) return;
      if (!/^[0-9]{1,20}$/.test(data.questionId)) throw new Error("题目标识格式变化，未创建本机文件");
      if (!data.translatedContent && !data.content) throw new Error("题面不可访问，可能需要会员权限");
      onChoose(data); close();
    } catch (e) { if (token === generation.current) setError(String(e)); }
    finally { if (token === generation.current) setBusy(false); }
  }
  return <dialog className="catalogue" ref={dialog} onCancel={e => { e.preventDefault(); close(); }} aria-labelledby="catalogue-title">
    <div className="catalogue-heading"><h2 id="catalogue-title">中国站题库</h2><button onClick={close}>关闭题库</button></div>
    <form onSubmit={e => { e.preventDefault(); void search(); }}>
      <input autoFocus aria-label="搜索中国站题目" placeholder="题号、名称或关键词" maxLength={100} value={keyword} onChange={e => setKeyword(e.target.value)} />
      <button disabled={busy} type="submit">{busy ? "读取中…" : "搜索"}</button>
    </form>
    <p className="muted">按需从 leetcode.cn 读取公开题目，不上传代码或笔记。空关键词可浏览题库。</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="catalogue-results" aria-busy={busy}>
      {result?.questions.map(q => <button data-slug={q.titleSlug} key={q.titleSlug} disabled={busy || q.paidOnly} onClick={() => choose(q.titleSlug)}>
        <span>{q.frontendQuestionId}</span><strong>{q.titleCn || q.title}</strong><small>{q.paidOnly ? "会员题暂未开放" : q.difficulty}</small>
      </button>)}
      {result && !result.questions.length && <p>没有匹配题目，换个关键词试试。</p>}
    </div>
    {result && <div className="catalogue-footer"><span>共 {result.total} 题 · 当前第 {Math.floor(offset / 25) + 1} 页</span><div>
      <button disabled={busy || offset === 0} onClick={() => search(Math.max(0, offset - 25))}>上一页</button>
      <button disabled={busy || !result.hasMore} onClick={() => search(offset + 25)}>下一页</button>
    </div></div>}
  </dialog>;
}
