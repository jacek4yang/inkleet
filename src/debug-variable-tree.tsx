import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import type { DebugVariable } from "./debug-model";
type Props = { variable: DebugVariable; token: string; read: (reference: number) => Promise<DebugVariable[]>; depth?: number };
/** DAP references are scoped to a single suspended session/frame, never persisted. */
export function VariableNode({ variable, token, read, depth = 0 }: Props) {
  const [open, setOpen] = useState(false), [items, setItems] = useState<DebugVariable[] | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const generation = useRef(0), mounted = useRef(true), reader = useRef(read);
  reader.current = read;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++generation.current; }; }, []);
  useEffect(() => { ++generation.current; setOpen(false); setItems(null); setError(""); setLoading(false); }, [token, variable.variablesReference]);
  async function toggle() {
    if (open) { ++generation.current; setOpen(false); setLoading(false); return; }
    setOpen(true);
    if (items) return;
    const request = ++generation.current;
    setLoading(true); setError("");
    try {
      const children = await reader.current(variable.variablesReference);
      if (mounted.current && request === generation.current) setItems(children.slice(0, 100));
    } catch (e) { if (mounted.current && request === generation.current) setError(String(e)); }
    finally { if (mounted.current && request === generation.current) setLoading(false); }
  }
  const expandable = variable.variablesReference > 0 && depth < 12;
  return <div className="debug-tree-node">
    <div className="debug-variable" style={{ paddingLeft: depth * 12 }}>
      <button type="button" aria-label={variable.name} aria-expanded={expandable ? open : undefined} disabled={!expandable} onClick={() => void toggle()} title={variable.type ?? variable.name}>
        {expandable && <span className={open ? "debug-chevron open" : "debug-chevron"}><Icon name="chevron" /></span>}
        {variable.name.slice(0, 200)}
      </button><code title={variable.type}>{variable.value.slice(0, 4000)}</code>
    </div>
    {open && <div className="debug-tree-children">
      {loading && <small role="status">读取中…</small>}
      {error && <small role="alert">{error}</small>}
      {items?.map((child, index) => <VariableNode key={index + ":" + child.name} variable={child} token={token} read={read} depth={depth + 1} />)}
      {items?.length === 0 && <small>无子项</small>}
      {items && (items.length >= 100 || (variable.namedVariables ?? 0) + (variable.indexedVariables ?? 0) > items.length) && <small>当前显示前 {items.length} 项</small>}
    </div>}
  </div>;
}
