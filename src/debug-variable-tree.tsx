import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { isRawDebugVariable, type DebugVariable } from "./debug-model";
import { knownVariableCount, mapEntryFields, pageRepeats, rustVisualKind, VARIABLE_NODE_LIMIT, VARIABLE_PAGE_SIZE, type VariableReader } from "./debug-visuals";
import "./debug-visuals.css";
type Props = { variable: DebugVariable; token: string; read: VariableReader; depth?: number; mapEntry?: boolean; fieldLabel?: string; ancestors?: number[] };
/** DAP references are scoped to a single suspended session/frame, never persisted. */
export function VariableNode({ variable, token, read, depth = 0, mapEntry = false, fieldLabel, ancestors = [] }: Props) {
  const [open, setOpen] = useState(false), [items, setItems] = useState<DebugVariable[] | null>(null);
  const [showRaw, setShowRaw] = useState(false), [details, setDetails] = useState(false);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false), [more, setMore] = useState(false);
  const [pagingNotice, setPagingNotice] = useState("");
  const generation = useRef(0), mounted = useRef(true), reader = useRef(read), busy = useRef(false), offset = useRef(0);
  reader.current = read;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++generation.current; }; }, []);
  useEffect(() => {
    ++generation.current; busy.current = false; offset.current = 0;
    setOpen(false); setShowRaw(false); setDetails(false); setItems(null); setError(""); setLoading(false); setMore(false); setPagingNotice("");
  }, [token, variable.variablesReference]);
  async function load(previous: DebugVariable[] = []) {
    if (busy.current || previous.length >= VARIABLE_NODE_LIMIT) return;
    busy.current = true;
    const request = ++generation.current, start = offset.current;
    setLoading(true); setError("");
    try {
      const page = await reader.current(variable.variablesReference, start, Math.min(VARIABLE_PAGE_SIZE, VARIABLE_NODE_LIMIT - previous.length));
      if (!mounted.current || request !== generation.current) return;
      if (start > 0 && pageRepeats(previous, page.items)) {
        setMore(false); setPagingNotice("调试器未提供下一页，已停止重复加载"); return;
      }
      const next = [...previous, ...page.items];
      setItems(next); offset.current = start + page.received;
      const total = knownVariableCount(variable);
      setMore(page.received >= VARIABLE_PAGE_SIZE && next.length < VARIABLE_NODE_LIMIT && (total === undefined || offset.current < total));
      if (page.limited) setPagingNotice("调试器返回超出分页范围；仅显示本页，后续分页取决于适配器支持");
      if (next.length >= VARIABLE_NODE_LIMIT) setPagingNotice("已达本节点 1000 项安全上限");
    } catch (e) { if (mounted.current && request === generation.current) setError(String(e)); }
    finally { if (mounted.current && request === generation.current) { busy.current = false; setLoading(false); } }
  }
  function toggle() {
    if (open) { ++generation.current; busy.current = false; setOpen(false); setLoading(false); return; }
    setOpen(true);
    if (!items) void load();
  }
  const cycle = ancestors.includes(variable.variablesReference) && variable.variablesReference > 0;
  const expandable = variable.variablesReference > 0 && depth < 12 && !cycle;
  const kind = rustVisualKind(variable.type), logical = items?.filter(child => showRaw || !isRawDebugVariable(child));
  const pair = mapEntry && !!logical && mapEntryFields(logical);
  const total = knownVariableCount(variable);
  const summary = variable.value.length > 180 ? variable.value.slice(0, 180) + "…" : variable.value;
  return <div className={`debug-tree-node debug-kind-${kind}`}>
    <div className="debug-variable" style={{ paddingLeft: depth * 12 }}>
      <button type="button" aria-label={variable.name} aria-expanded={expandable ? open : undefined} disabled={!expandable} onClick={toggle} title={variable.name}>
        {expandable && <span className={open ? "debug-chevron open" : "debug-chevron"}><Icon name="chevron" /></span>}
        {fieldLabel && <span className="debug-field-label">{fieldLabel}</span>}{variable.name}
      </button><code title={variable.value}>{summary}</code>
      <span className="debug-details-control"><button type="button" className="debug-value-details" aria-label={`查看变量详情 ${variable.name}`} aria-expanded={details} onClick={() => setDetails(value => !value)}>详情</button></span>
    </div>
    <div className="debug-variable-meta" style={{ paddingLeft: depth * 12 + 18 }}>
      <code>{variable.type ?? "类型未提供"}{variable.typeTruncated ? "（类型已截断）" : ""}</code>
      {total !== undefined ? <span>{total} 个子项</span> : variable.indexedVariables !== undefined ? <span>{variable.indexedVariables} 个索引元素</span> : null}
      {kind === "map" && <span>键 → 值</span>}{kind === "set" && <span>集合成员</span>}
      {cycle && <span>重复引用 · 已停止展开</span>}{depth >= 12 && variable.variablesReference > 0 && <span>已达展开深度上限</span>}
    </div>
    {details && <section className="debug-value-detail" aria-label={`变量详情 ${variable.name}`}>
      <strong>{variable.name}</strong><code>{variable.type ?? "类型未提供"}</code><pre tabIndex={0}>{variable.value}</pre>
      <small>{variable.valueTruncated ? "返回值超过 16000 字符，已截断；这不是完整值。" : "显示调试器返回的值；适配器自身可能提供摘要。"}</small>
    </section>}
    {open && <div className={`debug-tree-children${pair ? " debug-map-fields" : ""}`}>
      {logical?.map((child, index) => <VariableNode key={index + ":" + child.name} variable={child} token={token} read={read} depth={depth + 1} mapEntry={kind === "map" && !isRawDebugVariable(child)} fieldLabel={pair ? index === 0 ? "键" : "值" : undefined} ancestors={[...ancestors, variable.variablesReference]} />)}
      {loading && <small role="status">读取中…</small>}
      {error && <div role="alert"><small>{error}</small><button type="button" disabled={loading} onClick={() => void load(items ?? [])}>重试读取</button></div>}
      {items?.some(isRawDebugVariable) && <button type="button" className="debug-raw-toggle" aria-pressed={showRaw} onClick={() => setShowRaw(value => !value)}>{showRaw ? "隐藏内部结构" : "内部结构"}</button>}
      {items && logical?.length === 0 && <small>无子项</small>}
      {items && <div className="debug-page-controls"><small>已读取 {offset.current} 个子项{total === undefined ? " · 总数未提供" : ` / ${total}`}</small>{more && <button type="button" disabled={loading} onClick={() => void load(items)}>加载下一页</button>}{pagingNotice && <small role="status">{pagingNotice}</small>}</div>}
    </div>}
  </div>;
}
