import React, { useEffect, useRef, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import {statementVersion,type StatementLanguage} from "./reading-preferences";
import { parseQuestionLink } from "./question-link";

export type RemoteQuestion = {
  questionId: string; questionFrontendId: string; title: string; titleSlug: string;
  translatedTitle: string | null; content: string | null; translatedContent: string | null;
  isPaidOnly: boolean; difficulty: string; sampleTestCase: string | null;
  exampleTestcases: string | null; metaData: string | null;
  codeSnippets: { langSlug: string; code: string }[] | null;
};
export type QuestionSummary = {
  frontendQuestionId: string; title: string; titleCn: string | null;
  titleSlug: string; difficulty: string; paidOnly: boolean; status?: "AC" | "TRIED" | "UNKNOWN" | null;
};
export type QuestionList = { questions: QuestionSummary[]; total: number; hasMore: boolean };
type Result = QuestionList;

export async function readQuestion(slug: string) {
  const fetched = await invoke<{ question: RemoteQuestion; cacheWarning: string | null; fromCache?: boolean }>("get_question", { slug });
  const data = fetched.question;
  if (!/^[0-9]{1,20}$/.test(data.questionId)) throw new Error("题目标识格式变化，未创建本机文件");
  if (data.titleSlug !== slug) throw new Error("返回的题目与链接不一致，未切换题目");
  if (!data.translatedContent && !data.content) throw new Error("题面不可访问，可能需要会员权限");
  return fetched;
}

// 题面是不可信远程 HTML。仅保留排版，无脚本、表单、链接导航、远程资源或自定义元素。
export const QuestionStatement=React.memo(function QuestionStatement({ question, language="zh" }: { question: RemoteQuestion; language?:StatementLanguage }) {
  const version=statementVersion(question,language),raw=version.content;
  const clean = useMemo(() => DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ["p", "div", "span", "strong", "b", "em", "i", "u", "s", "br", "hr",
      "pre", "code", "ul", "ol", "li", "h2", "h3", "h4", "blockquote",
      "table", "thead", "tbody", "tr", "td", "th", "sup", "sub"],
    ALLOWED_ATTR: ["colspan", "rowspan"],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  }), [raw]);
  return <>
    <p className="eyebrow">力扣中国站 · {question.questionFrontendId} <span className="badge">{question.difficulty}</span></p>
    <h1>{version.title}</h1>
    {version.fallback && <p className="muted" role="status">{language==="zh"?"暂无中文题面，显示英文原文。":"暂无英文题面，显示中文题面。"}</p>}
    {clean ? <div className="question-content" lang={version.language==="zh"?"zh-CN":"en"} dangerouslySetInnerHTML={{ __html: clean }} /> :
      <p className="error">{question.isPaidOnly ? "此题需要会员权限；当前只读接入不访问会员题面。" : "题面暂不可用，请稍后重试。"}</p>}
    {/<(?:img|svg|math)\b/i.test(raw) && <p className="muted">此题包含图示或公式；当前预览尚未呈现这些内容，请对照官方题面。</p>}
    <p className="question-source">题目来源：leetcode.cn/problems/{question.titleSlug}/</p>
  </>;
});

export function Catalogue({ onChoose, onClose, initialMode = "search" }: {
  onChoose: (question: RemoteQuestion, cacheWarning?: string | null, fromCache?: boolean) => void; onClose: () => void;
  initialMode?: "search" | "link";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const inFlight = useRef<number | null>(null);
  const [mode, setMode] = useState(initialMode);
  const [keyword, setKeyword] = useState("");
  const [link, setLink] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [offset, setOffset] = useState(0);
  const [lastKeyword, setLastKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    return () => { generation.current++; inFlight.current = null; };
  }, []);
  function invalidate() { generation.current++; inFlight.current = null; setBusy(false); setError(""); }
  function close() { generation.current++; inFlight.current = null; onClose(); }
  function beginRequest(): number | null {
    if (inFlight.current !== null) return null;
    const token = ++generation.current;
    inFlight.current = token; setBusy(true); setError("");
    return token;
  }
  function endRequest(token: number) {
    if (token !== generation.current) return;
    inFlight.current = null; setBusy(false);
  }
  async function search(next = 0) {
    const token = beginRequest(); if (token === null) return;
    const term = next === 0 ? keyword : lastKeyword;
    try {
      const data = await invoke<Result>("search_questions", { keyword: term, offset: next });
      if (token !== generation.current) return;
      setResult(data); setOffset(next); setLastKeyword(term);
    } catch (e) { if (token === generation.current) setError(String(e)); }
    finally { endRequest(token); }
  }
  async function choose(slug: string) {
    const token = beginRequest(); if (token === null) return;
    try {
      const fetched = await readQuestion(slug);
      if (token !== generation.current) return;
      const data = fetched.question;
      onChoose(data, fetched.cacheWarning, fetched.fromCache ?? false); close();
    } catch (e) { if (token === generation.current) setError(String(e)); }
    finally { endRequest(token); }
  }
  function openLink() {
    if (inFlight.current !== null) return;
    try { const parsed = parseQuestionLink(link); void choose(parsed.slug); }
    catch (e) { setError(e instanceof Error ? e.message : "无法解析题目链接"); }
  }
  function changeMode(next: "search" | "link") { invalidate(); setMode(next); }
  return <dialog className="catalogue" ref={dialog} onCancel={e => { e.preventDefault(); close(); }} aria-labelledby="catalogue-title">
    <div className="catalogue-heading"><h2 id="catalogue-title">中国站题库</h2><button onClick={close}>关闭题库</button></div>
    <div className="catalogue-modes" aria-label="打开题目的方式">
      <button aria-pressed={mode === "search"} onClick={() => changeMode("search")}>按关键词</button>
      <button aria-pressed={mode === "link"} onClick={() => changeMode("link")}>粘贴链接</button>
    </div>
    <form onSubmit={e => { e.preventDefault(); if (mode === "link") openLink(); else void search(); }}>
      {mode === "link" ? <input key="link" autoFocus type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="力扣题目链接" placeholder="https://leetcode.cn/problems/two-sum/" maxLength={4096} value={link} onChange={e => { invalidate(); setLink(e.target.value); }} /> :
        <input key="search" autoFocus aria-label="搜索中国站题目" placeholder="题号、名称或关键词" maxLength={100} value={keyword} onChange={e => { invalidate(); setKeyword(e.target.value); }} />}
      <button disabled={busy} type="submit">{busy ? "读取中…" : mode === "link" ? "打开题目" : "搜索"}</button>
    </form>

    {error && <p role="alert" className="error">{error}</p>}
    {mode === "search" && <>
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
    </>}
  </dialog>;
}
