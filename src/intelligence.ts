import { invoke, isTauri } from "@tauri-apps/api/core";
import { EditorView, hoverTooltip, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Started = { id: number; version: number; server: string; uri: string };
export type Source = { name: string; text: string; declaration: boolean; line: number };
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function offset(doc: Text, position: unknown): number | null {
  if (!object(position) || !Number.isInteger(position.line) || !Number.isInteger(position.character) || position.line < 0 || position.character < 0 || position.line >= doc.lines) return null;
  const line = doc.line(position.line + 1);
  return position.character <= line.length ? line.from + position.character : null;
}
function range(doc: Text, value: unknown) {
  if (!object(value)) return null;
  const from = offset(doc, value.start), to = offset(doc, value.end);
  return from !== null && to !== null && from <= to ? { from, to } : null;
}
function content(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 32768);
  if (Array.isArray(value)) return value.slice(0, 20).map(content).join("\n\n").slice(0, 32768);
  return object(value) && typeof value.value === "string" ? value.value.slice(0, 32768) : "";
}
export function pythonIntelligence(status: (text: string) => void, showSource: (source: Source) => void) {
  const signatureEffect = StateEffect.define<Tooltip | null>();
  const signatureField = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, transaction) {
      if (transaction.docChanged || transaction.selection) value = null;
      for (const effect of transaction.effects) if (effect.is(signatureEffect)) value = effect.value;
      return value;
    },
    provide: field => showTooltip.from(field),
  });
  let signatureGeneration = 0;
  let signatureTimer: ReturnType<typeof setTimeout> | undefined;
  let view: EditorView | null = null, session: Started | null = null, closed = false;
  let version = 1, sent: Text | null = null, synchronization = Promise.resolve();
  let changeTimer: ReturnType<typeof setTimeout> | undefined, pollTimer: ReturnType<typeof setTimeout> | undefined;
  function flush() {
    synchronization = synchronization.then(async () => {
      while (!closed && view && session && sent !== view.state.doc) {
        const doc = view.state.doc, nextVersion = ++version;
        await invoke("update_language_document", { id: session.id, version: nextVersion, text: doc.toString() });
        sent = doc;
      }
    });
    return synchronization;
  }
  async function request(kind: string, pos: number, doc: Text): Promise<unknown> {
    if (!session || closed || !view) return null;
    await flush();
    if (closed || !session || view.state.doc !== doc) return null;
    const line = doc.lineAt(pos), askedVersion = version, id = session.id;
    const result = await invoke("language_request", { id, version: askedVersion, kind, line: line.number - 1, character: pos - line.from });
    return !closed && session?.id === id && version === askedVersion && view.state.doc === doc ? result : null;
  }
  async function complete(context: CompletionContext) {
    if (!session || !view) return null;
    const word = context.matchBefore(/\w*/);
    if (!context.explicit && !word?.text && context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos) !== ".") return null;
    context.addEventListener("abort", () => {}, { onDocChange: true });
    const doc = context.state.doc;
    try {
      const result = await request("completion", context.pos, doc);
      if (context.aborted || !view || view.state.doc !== doc) return null;
      const items = Array.isArray(result) ? result : object(result) && Array.isArray(result.items) ? result.items : [];
      const options: Completion[] = [];
      for (const item of items.slice(0, 300)) {
        if (!object(item) || typeof item.label !== "string" || item.label.length > 512 || item.insertTextFormat === 2) continue;
        const primary = object(item.textEdit) ? item.textEdit : null;
        const editRange = primary ? range(doc, primary.range ?? primary.replace ?? primary.insert) : { from: word?.from ?? context.pos, to: context.pos };
        const insert = primary?.newText ?? item.insertText ?? item.label;
        if (!editRange || typeof insert !== "string" || insert.length > 65536) continue;
        const changes = [{ ...editRange, insert }];
        let valid = true;
        if (Array.isArray(item.additionalTextEdits)) {
          if (item.additionalTextEdits.length > 20) continue;
          for (const edit of item.additionalTextEdits) {
            const r = object(edit) ? range(doc, edit.range) : null;
            if (!r || typeof edit.newText !== "string" || edit.newText.length > 65536) { valid = false; break; }
            changes.push({ ...r, insert: edit.newText });
          }
        }
        changes.sort((a, b) => a.from - b.from || a.to - b.to);
        for (let i = 1; i < changes.length; i++) if (changes[i].from < changes[i - 1].to || changes[i].from === changes[i - 1].from) valid = false;
        if (!valid) continue;
        const anchor = editRange.from + insert.length + changes.filter(c => c.from < editRange.from).reduce((sum, c) => sum + c.insert.length - (c.to - c.from), 0);
        options.push({
          label: item.label, detail: typeof item.detail === "string" ? item.detail.slice(0, 500) : undefined,
          info: content(item.documentation), type: ({ 2: "method", 3: "function", 5: "property", 6: "variable", 7: "class", 9: "namespace", 14: "keyword" } as Record<number, string>)[item.kind] ?? "text",
          apply(target) { if (!closed && target.state.doc === doc) target.dispatch({ changes, selection: { anchor }, userEvent: "input.complete" }); },
        });
      }
      return options.length ? { from: word?.from ?? context.pos, options } : null;
    } catch { return null; }
  }
  async function hover(target: EditorView, pos: number): Promise<Tooltip | null> {
    const doc = target.state.doc;
    try {
      const result = await request("hover", pos, doc);
      if (!object(result) || closed || target.state.doc !== doc) return null;
      const text = content(result.contents); if (!text) return null;
      const span = range(doc, result.range) ?? { from: pos, to: pos };
      return { pos: span.from, end: span.to, above: true, create() {
        const dom = document.createElement("div"); dom.className = "lsp-hover"; dom.textContent = text; return { dom };
      }};
    } catch { return null; }
  }
  async function signatureHelp() {
    if (!view || closed || view.composing) return;
    const target = view, doc = target.state.doc, pos = target.state.selection.main.head, generation = ++signatureGeneration;
    try {
      const result = await request("signatureHelp", pos, doc);
      if (closed || generation !== signatureGeneration || view !== target || target.state.doc !== doc || target.state.selection.main.head !== pos || target.composing) return;
      if (!object(result) || !Array.isArray(result.signatures) || !result.signatures.length) {
        target.dispatch({ effects: signatureEffect.of(null) }); return;
      }
      const index = Number.isInteger(result.activeSignature) ? Math.max(0, Math.min(result.signatures.length - 1, result.activeSignature)) : 0;
      const signature = result.signatures[index];
      if (!object(signature) || typeof signature.label !== "string") return;
      const parameter = Number.isInteger(signature.activeParameter) ? signature.activeParameter : result.activeParameter;
      const parameters = Array.isArray(signature.parameters) ? signature.parameters : [];
      const current = Number.isInteger(parameter) && parameter >= 0 ? parameters[parameter] : null;
      const label = signature.label.slice(0, 4096);
      const documentation = [content(signature.documentation), object(current) ? content(current.documentation) : ""].filter(Boolean).join("\n\n").slice(0, 8192);
      target.dispatch({ effects: signatureEffect.of({ pos, above: true, create() {
        const dom = document.createElement("div"); dom.className = "lsp-signature"; dom.setAttribute("role", "status");
        const heading = document.createElement("div"); heading.className = "lsp-signature-label"; heading.textContent = label; dom.append(heading);
        if (Number.isInteger(parameter) && parameter >= 0 && parameter < parameters.length) {
          const active = document.createElement("div"); active.textContent = "当前参数：" + (parameter + 1) + " / " + parameters.length; dom.append(active);
        }
        if (documentation) { const details = document.createElement("div"); details.textContent = documentation; dom.append(details); }
        return { dom };
      } }) });
    } catch { if (!closed && generation === signatureGeneration && view === target && target.state.doc === doc) target.dispatch({ effects: signatureEffect.of(null) }); }
  }
  async function definition(pos: number) {
    if (!view) return;
    const doc = view.state.doc;
    try {
      const result = await request("definition", pos, doc);
      const first = Array.isArray(result) ? result[0] : result;
      if (!object(first) || !view || closed || view.state.doc !== doc) return;
      const uri = first.uri ?? first.targetUri, location = first.range ?? first.targetSelectionRange ?? first.targetRange;
      if (typeof uri !== "string" || !object(location) || !object(location.start)) return;
      if (uri === session?.uri) {
        const anchor = offset(doc, location.start);
        if (anchor !== null) view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
        return;
      }
      const id = session?.id; if (!id) return;
      const source = await invoke<Omit<Source, "line">>("read_language_source", { id, uri });
      if (!closed && session?.id === id && view.state.doc === doc) showSource({ ...source, line: Number.isInteger(location.start.line) ? location.start.line : 0 });
    } catch (e) { if (!closed) status(String(e)); }
  }
  async function poll() {
    if (!session || !view || closed) return;
    try {
      await flush();
      const id = session.id, askedVersion = version, doc = view.state.doc;
      const result = await invoke<{ version: number; diagnostics: unknown[] }>("language_diagnostics", { id });
      if (!closed && session?.id === id && askedVersion === version && result.version === version && view.state.doc === doc) {
        const diagnostics: Diagnostic[] = [];
        for (const item of (Array.isArray(result.diagnostics) ? result.diagnostics : []).slice(0, 200)) {
          if (!object(item) || typeof item.message !== "string") continue;
          const span = range(doc, item.range); if (!span) continue;
          diagnostics.push({ ...span, severity: item.severity === 1 ? "error" : item.severity === 2 ? "warning" : "info", message: item.message.slice(0, 4000), source: "Pyright" });
        }
        view.dispatch(setDiagnostics(view.state, diagnostics));
      }
    } catch (e) { if (!closed) status(String(e)); }
    finally { if (!closed) pollTimer = setTimeout(poll, 1000); }
  }
  const extensions: Extension[] = [
    signatureField,
    autocompletion({ override: [complete], activateOnTyping: true, maxRenderedOptions: 60 }),
    hoverTooltip(hover, { hoverTime: 350 }),
    keymap.of([{ key: "Ctrl-Shift-Space", run() { void signatureHelp(); return true; } }, { key: "Escape", run(target) { ++signatureGeneration; clearTimeout(signatureTimer); if (!target.state.field(signatureField)) return false; target.dispatch({ effects: signatureEffect.of(null) }); return true; } }, { key: "F12", run(target) { void definition(target.state.selection.main.head); return true; } }]),
    EditorView.domEventHandlers({ mousedown(event, target) {
      if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
      const pos = target.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      event.preventDefault(); void definition(pos); return true;
    }}),
    EditorView.updateListener.of(update => {
      if (update.docChanged || update.selectionSet) { ++signatureGeneration; clearTimeout(signatureTimer); }
      if (update.docChanged && !closed && !update.view.composing && /[(,]$/.test(update.state.doc.sliceString(Math.max(0, update.state.selection.main.head - 1), update.state.selection.main.head))) signatureTimer = setTimeout(() => { void signatureHelp(); }, 180);
      if (update.docChanged && !closed) {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => { void flush().catch(e => { if (!closed) status(String(e)); }); }, 150);
      }
    }),
  ];
  return {
    extensions,
    async connect(target: EditorView) {
      view = target;
      if (!isTauri()) { status("浏览器预览 · 语言服务需原生客户端"); return; }
      status("正在连接 Python 语言服务…");
      const initial = target.state.doc;
      try {
        const started = await invoke<Started>("start_language_service", { text: initial.toString() });
        if (closed) { await invoke("stop_language_service", { id: started.id }); return; }
        session = started; version = started.version; sent = initial;
        await flush();
        if (!closed) { status("Pyright 已连接 · F12 / Ctrl+单击查看定义"); void poll(); }
      } catch (e) { if (!closed) status(String(e)); }
    },
    destroy() {
      closed = true; ++signatureGeneration; clearTimeout(signatureTimer); clearTimeout(changeTimer); clearTimeout(pollTimer);
      if (session) void invoke("stop_language_service", { id: session.id }).catch(() => {});
      session = null; view = null;
    },
  };
}
