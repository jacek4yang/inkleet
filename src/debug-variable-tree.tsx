import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import { isRawDebugVariable, type DebugVariable } from "./debug-model";
import { compactDebugType, emptyDebugCollection, knownVariableCount, pageRepeats, readMapPairs, rustVisualKind, MAP_PAGE_SIZE, VARIABLE_NODE_LIMIT, VARIABLE_PAGE_SIZE, type MapPair, type VariableReader } from "./debug-visuals";
import "./debug-visuals.css";
type Props = { variable: DebugVariable; token: string; read: VariableReader; depth?: number; ancestors?: number[]; collectionElement?: boolean; cellLabel?: string };
type PairResult = { pair: MapPair | null; error?: string };

/** Fetch only the visible map's pair fields, with four in-flight requests at most. */
function MapRows({ entries, token, read, depth, ancestors }: { entries: DebugVariable[]; token: string; read: VariableReader; depth: number; ancestors: number[] }) {
  const cache = useRef(new Map<DebugVariable, PairResult>()), reader = useRef(read);
  const [results, setResults] = useState(new Map<DebugVariable, PairResult>());
  const [retry, setRetry] = useState(0);
  reader.current = read;
  useEffect(() => {
    let active = true;
    const missing = entries.filter(entry => !cache.current.has(entry));
    void readMapPairs(missing, (...args) => reader.current(...args), () => active, (index, pair, error) => {
      cache.current.set(missing[index], { pair, error });
      setResults(new Map(cache.current));
    });
    return () => { active = false; };
  }, [entries, token, retry]);
  return <div className="debug-map-rows" role="table" aria-label="映射条目">
    <div className="sr-only" role="row"><span role="columnheader">键</span><span role="columnheader">值</span></div>
    {entries.map((entry, index) => {
      const result = results.get(entry);
      if (!result) return <div className="debug-map-loading" role="row" key={index}><span role="cell" aria-label={`读取映射条目 ${entry.name}`}>…</span></div>;
      if (!result.pair) return <div className="debug-map-fallback" key={index}>
        <VariableNode variable={entry} token={token} read={read} depth={depth} ancestors={ancestors} collectionElement />
        {result.error && <button type="button" title={result.error} onClick={() => { cache.current.delete(entry); setRetry(value => value + 1); }}>重试</button>}
      </div>;
      return <div className="debug-map-row" role="row" data-entry-name={entry.name} key={index}>
        <div role="cell" data-map-field="key" data-source-name={result.pair.key.name}>
          <VariableNode variable={result.pair.key} token={token} read={read} depth={depth} ancestors={[...ancestors, entry.variablesReference]} collectionElement cellLabel={`${entry.name} 的键`} />
        </div>
        <div role="cell" data-map-field="value" data-source-name={result.pair.value.name}>
          <VariableNode variable={result.pair.value} token={token} read={read} depth={depth} ancestors={[...ancestors, entry.variablesReference]} collectionElement cellLabel={`${entry.name} 的值`} />
        </div>
      </div>;
    })}
  </div>;
}

/** DAP references are scoped to a single suspended session/frame, never persisted. */
export function VariableNode({ variable, token, read, depth = 0, ancestors = [], collectionElement = false, cellLabel }: Props) {
  const [open, setOpen] = useState(false), [items, setItems] = useState<DebugVariable[] | null>(null);
  const [showRaw, setShowRaw] = useState(false), [details, setDetails] = useState(false);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false), [more, setMore] = useState(false);
  const [pagingNotice, setPagingNotice] = useState("");
  const generation = useRef(0), mounted = useRef(true), reader = useRef(read), busy = useRef(false), offset = useRef(0);
  reader.current = read;
  const kind = rustVisualKind(variable.type), pageSize = kind === "map" ? MAP_PAGE_SIZE : VARIABLE_PAGE_SIZE;
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
      const page = await reader.current(variable.variablesReference, start, Math.min(pageSize, VARIABLE_NODE_LIMIT - previous.length));
      if (!mounted.current || request !== generation.current) return;
      if (start > 0 && pageRepeats(previous, page.items)) {
        setMore(false); setPagingNotice("调试器未提供下一页，已停止重复加载"); return;
      }
      const next = [...previous, ...page.items];
      setItems(next); offset.current = start + page.received;
      const total = knownVariableCount(variable);
      setMore(page.received >= pageSize && next.length < VARIABLE_NODE_LIMIT && (total === undefined || offset.current < total));
      if (page.limited) setPagingNotice("调试器返回超出分页范围；后续分页取决于适配器支持");
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
  const logical = useMemo(() => items?.filter(child => !isRawDebugVariable(child)) ?? [], [items]);
  const raw = useMemo(() => items?.filter(isRawDebugVariable) ?? [], [items]);
  const total = knownVariableCount(variable);
  const summary = !expandable && ["map", "set", "sequence"].includes(kind) && emptyDebugCollection(variable) ? "空" : variable.value.length > 180 ? variable.value.slice(0, 180) + "…" : variable.value;
  const visibleType = !collectionElement || expandable && kind !== "string" ? compactDebugType(variable.type) : "";
  const needsDetails = variable.value.length > 180 || variable.valueTruncated || variable.typeTruncated || !!cellLabel && expandable && variable.value.length > 24;
  const placeholder = /^\{\s*(?:\.\.\.|…)?\s*\}$/.test(variable.value.trim());
  return <div className={`debug-tree-node debug-kind-${kind}${cellLabel ? " debug-map-cell" : ""}`}>
    <div className="debug-variable" style={{ paddingLeft: cellLabel ? 0 : depth * 12 }}>
      <button type="button" aria-label={cellLabel ?? variable.name} aria-expanded={expandable ? open : cellLabel ? details : undefined} disabled={!expandable && !cellLabel} onClick={expandable ? toggle : () => setDetails(value => !value)} title={cellLabel ? `${variable.value}\n${variable.type ?? ""}` : variable.type ? `${variable.name}: ${variable.type}` : variable.name}>
        {expandable && <span className={open ? "debug-chevron open" : "debug-chevron"}><Icon name="chevron" /></span>}
        {cellLabel ? <code title={variable.value}>{summary}</code> : variable.name}
      </button>
      {!cellLabel && <code title={variable.value}>{["map", "set", "sequence"].includes(kind) && placeholder && expandable ? "" : summary}</code>}
      {visibleType && <span className="debug-variable-type" title={variable.type}>{visibleType}</span>}
      {open && raw.length > 0 && <button type="button" className="debug-raw-toggle" aria-label={showRaw ? "隐藏内部结构" : "内部结构"} title={showRaw ? "隐藏内部结构" : "查看内部结构"} aria-pressed={showRaw} onClick={() => setShowRaw(value => !value)}>⋯</button>}
      {needsDetails && (!cellLabel || expandable) && <button type="button" className="debug-value-details" aria-label={`查看变量详情 ${cellLabel ?? variable.name}`} aria-expanded={details} onClick={() => setDetails(value => !value)} title="展开完整返回值">…</button>}
    </div>
    {(cycle || depth >= 12 && variable.variablesReference > 0) && <small className="debug-node-limit">{cycle ? "重复引用 · 已停止展开" : "已达展开深度上限"}</small>}
    {details && <section className="debug-value-detail" aria-label={`变量详情 ${cellLabel ?? variable.name}`}>
      <code>{variable.type ?? ""}</code><pre tabIndex={0}>{variable.value}</pre>
      {variable.valueTruncated && <small>返回值超过 16000 字符，已截断；这不是完整值。</small>}
    </section>}
    {open && <div className="debug-tree-children">
      {kind === "map" && logical.length > 0
        ? <MapRows key={token} entries={logical} token={token} read={read} depth={depth + 1} ancestors={[...ancestors, variable.variablesReference]} />
        : logical.map((child, index) => <VariableNode key={index + ":" + child.name} variable={child} token={token} read={read} depth={depth + 1} collectionElement={kind === "sequence" || kind === "set"} ancestors={[...ancestors, variable.variablesReference]} />)}
      {showRaw && raw.map((child, index) => <VariableNode key={`raw:${index}`} variable={child} token={token} read={read} depth={depth + 1} ancestors={[...ancestors, variable.variablesReference]} />)}
      {loading && <small role="status">读取中…</small>}
      {error && <div role="alert"><small>{error}</small><button type="button" disabled={loading} onClick={() => void load(items ?? [])}>重试读取</button></div>}
      {items && logical.length === 0 && !loading && !error && <small>{["map", "set", "sequence"].includes(kind) ? emptyDebugCollection(variable) ? "空" : "调试器未提供元素" : "无子项"}</small>}
      {(more || pagingNotice) && <div className="debug-page-controls">{more && <button type="button" disabled={loading} onClick={() => void load(items ?? [])}>加载下一页</button>}<small>{offset.current}{total === undefined ? "" : ` / ${total}`}</small>{pagingNotice && <small role="status">{pagingNotice}</small>}</div>}
    </div>}
  </div>;
}
