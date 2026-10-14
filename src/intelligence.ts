import { decodeSemanticSpans, semanticField, semanticTheme, setSemanticTokens } from "./semantic-tokens";
// Bound pending formatter work across destroyed/recreated EditorViews.
let formatQueue:Promise<unknown>=Promise.resolve();let queuedFormats=0;
import { DocumentSyncQueue } from "./document-sync-queue";
import { findReferences } from "./references";
import { renameSymbol } from "./rename";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { EditorView, hoverTooltip, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Started = { id: number; version: number; server: string; uri: string; semanticTokens?: boolean };
export type Source = { name: string; text: string; declaration: boolean; line: number; language?: "python3" | "java" | "golang" | "rust" | "c" | "cpp" };
let connectionQueue: Promise<void> = Promise.resolve();
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
export function languageIntelligence(language: "python3" | "java" | "golang" | "rust" | "c" | "cpp", status: (text: string) => void, showSource: (source: Source) => void, metadata?: string) {
  const serverName = { python3: "Pyright", java: "JDT LS", golang: "gopls", rust: "rust-analyzer", c: "clangd", cpp: "clangd" }[language];
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
  let semanticGeneration=0, semanticBusy=false, semanticPending=false, semanticRevision=0, semanticRetries=0;
  let semanticTimer:ReturnType<typeof setTimeout>|undefined;
  function scheduleSemantic(){
    ++semanticGeneration;semanticRetries=0;semanticPending=true;clearTimeout(semanticTimer);
    semanticTimer=setTimeout(()=>{void semantic();},300);
  }
  async function semantic(){
    if(semanticBusy||closed||!view||!session?.semanticTokens)return;
    if(view.composing){semanticTimer=setTimeout(()=>{void semantic();},300);return;}
    semanticBusy=true;semanticPending=false;
    const target=view,doc=target.state.doc,generation=semanticGeneration,id=session.id;
    try{
      await flush();
      if(closed||view!==target||session?.id!==id||target.state.doc!==doc||generation!==semanticGeneration)return;
      const askedVersion=version;
      const result=await invoke<{version:number;tokens:unknown}>("language_semantic_tokens",{id,version:askedVersion});
      if(closed||view!==target||session?.id!==id||version!==askedVersion||result.version!==askedVersion||target.state.doc!==doc||generation!==semanticGeneration||target.composing)return;
      const spans=decodeSemanticSpans(doc,result.tokens);
      target.dispatch({effects:setSemanticTokens.of(spans)});
      if(!spans.length)retrySemantic();
    }catch{
      // At most two readiness retries per snapshot, never restart the server.
      retrySemantic();
    }finally{
      semanticBusy=false;
      if(!closed&&semanticPending){clearTimeout(semanticTimer);semanticTimer=setTimeout(()=>{void semantic();},300);}
    }
  }
  function retrySemantic(){
    if(closed||semanticPending||semanticRetries>=2)return;
    clearTimeout(semanticTimer);
    semanticTimer=setTimeout(()=>{void semantic();},1000*++semanticRetries);
  }
  let signatureGeneration = 0;
  let signatureTimer: ReturnType<typeof setTimeout> | undefined;
  let view: EditorView | null = null, session: Started | null = null, closed = false;
  let version = 1, sent: Text | null = null;
  const synchronization = new DocumentSyncQueue();
  let changeTimer: ReturnType<typeof setTimeout> | undefined, pollTimer: ReturnType<typeof setTimeout> | undefined;
  function flush() {
    return synchronization.run(async () => {
      while (!closed && view && session && sent !== view.state.doc) {
        const doc = view.state.doc, nextVersion = ++version;
        await invoke("update_language_document", { id: session.id, version: nextVersion, text: doc.toString() });
        sent = doc;
      }
    });
  }
  async function request(kind: string, pos: number, doc: Text, newName?: string): Promise<unknown> {
    if (!session || closed || !view) return null;
    await flush();
    if (closed || !session || view.state.doc !== doc) return null;
    const line = doc.lineAt(pos), askedVersion = version, id = session.id;
    const result = await invoke("language_request", { id, version: askedVersion, kind, line: line.number - 1, character: pos - line.from, newName: newName ?? null });
    return !closed && session?.id === id && version === askedVersion && view.state.doc === doc ? result : null;
  }
  async function complete(context: CompletionContext) {
    if (!session || !view) return null;
    const word = context.matchBefore(/\w*/);
    if (!context.explicit && !word?.text && context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos) !== ".") return null;
    context.addEventListener("abort", () => {}, { onDocChange: true });
    const doc = context.state.doc;
    try {
      const deadline = Date.now() + (context.explicit ? 8000 : 1200);
      let items: unknown[] = [];
      for (let attempt = 0; ; attempt++) {
        const result = await request("completion", context.pos, doc);
        if (context.aborted || !view || view.state.doc !== doc || view.state.selection.main.head !== context.pos) return null;
        items = Array.isArray(result) ? result : object(result) && Array.isArray(result.items) ? result.items : [];
        if (items.length || Date.now() >= deadline) break;
        // initialize confirms transport readiness, not completed project indexing.
        // Re-query only this unchanged completion context; never restart a server.
        if (context.explicit) status(serverName + " 正在准备补全…");
        await new Promise(resolve => setTimeout(resolve, Math.min(200 * 2 ** attempt, 1200)));
        if (context.aborted || closed || !view || view.state.doc !== doc || view.state.selection.main.head !== context.pos) return null;
      }
      const options: Completion[] = [];
      const needle = word?.text.toLocaleLowerCase() ?? "";
      // Filter before limiting: large standard libraries can put the desired member after item 300.
      const candidates = items.slice(0, 5000).filter((item): item is Record<string, any> => object(item) && typeof item.label === "string" &&
        (!needle || String(item.filterText ?? item.label).toLocaleLowerCase().includes(needle)));
      candidates.sort((a, b) => String(a.sortText ?? a.label).localeCompare(String(b.sortText ?? b.label)));
      for (const item of candidates.slice(0, 300)) {
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
          label: typeof item.filterText === "string" ? item.filterText.slice(0, 512) : item.label.trimStart(), displayLabel: item.label.trimStart(), detail: typeof item.detail === "string" ? item.detail.slice(0, 500) : undefined,
          info: content(item.documentation), type: ({ 2: "method", 3: "function", 5: "property", 6: "variable", 7: "class", 9: "namespace", 14: "keyword" } as Record<number, string>)[item.kind] ?? "text",
          apply(target) { if (!closed && target.state.doc === doc) target.dispatch({ changes, selection: { anchor }, userEvent: "input.complete" }); },
        });
      }
      if (context.explicit) status(options.length ? serverName + " 已连接 · F12 / Ctrl+单击查看定义" : serverName + " 未找到匹配补全 · 服务返回 " + items.length + " 项");
      return options.length ? { from: word?.from ?? context.pos, options } : null;
    } catch (error) { if (context.explicit && !closed) status(serverName + " 补全暂不可用：" + String(error).slice(0, 300)); return null; }
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
      const result = await invoke<{ version: number; diagnostics: unknown[]; semanticRevision?:number }>("language_diagnostics", { id });
      if (!closed && session?.id === id && askedVersion === version && result.version === version && view.state.doc === doc) {
        if(Number.isSafeInteger(result.semanticRevision)&&result.semanticRevision!==semanticRevision){semanticRevision=result.semanticRevision!;scheduleSemantic();}
        const diagnostics: Diagnostic[] = [];
        for (const item of (Array.isArray(result.diagnostics) ? result.diagnostics : []).slice(0, 200)) {
          if (!object(item) || typeof item.message !== "string") continue;
          const span = range(doc, item.range); if (!span) continue;
          diagnostics.push({ ...span, severity: item.severity === 1 ? "error" : item.severity === 2 ? "warning" : "info", message: item.message.slice(0, 4000), source: serverName });
        }
        view.dispatch(setDiagnostics(view.state, diagnostics));
      }
    } catch (e) { if (!closed) status(String(e)); }
    finally { if (!closed) pollTimer = setTimeout(poll, 1000); }
  }
  const references = findReferences((pos, doc) => request("references", pos, doc), status);
  const rename = renameSymbol((pos, doc, name) => request("rename", pos, doc, name), status);
  const extensions: Extension[] = [
    ...references.extensions,
    ...rename.extensions,
    signatureField,
    semanticField, semanticTheme,
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
        scheduleSemantic();
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => { void flush().catch(e => { if (!closed) status(String(e)); }); }, 150);
      }
    }),
  ];
  return {
    extensions,
    async format(text:string):Promise<string>{
      if(queuedFormats>=8)throw Error("格式化请求过多，请稍后保存");
      ++queuedFormats;
      const request=formatQueue.then(async()=>{
      if(closed||!view||view.state.doc.toString()!==text)throw Error("格式化文档已切换");
      const doc=view.state.doc;
      if(["c","cpp","java"].includes(language)){
        if(!session)throw Error("语言服务尚未连接");
        await flush();
        if(closed||!session||!view||view.state.doc!==doc)throw Error("格式化快照已过期");
      }
      const id=session?.id??null,askedVersion=version;
      const result=await invoke<string>("format_source",{language,text,id,version:id===null?null:askedVersion});
      if(closed||!view||view.state.doc!==doc||(["c","cpp","java"].includes(language)&&(session?.id!==id||version!==askedVersion)))throw Error("忽略过期格式化结果");
      if(typeof result!=="string")throw Error("格式化器未返回正文");
      return result;
      }).finally(()=>{--queuedFormats;});
      formatQueue=request.then(()=>undefined,()=>undefined);
      return request;
    },
    async connect(target: EditorView) {
      view = target;
      target.dispatch({effects:setSemanticTokens.of([])});
      if (!isTauri()) { status("浏览器预览 · 语言服务需原生客户端"); return; }
      status(`正在连接 ${{ python3: "Python", java: "Java", golang: "Go", rust: "Rust", c: "C", cpp: "C++" }[language]} 语言服务…`);
      const initial = target.state.doc;
      try {
        const connecting = connectionQueue.then(() => closed ? null : invoke<Started>("start_language_service", {text: initial.toString(), language, metadata: metadata ?? null}));
        connectionQueue = connecting.then(() => undefined, () => undefined);
        const started = await connecting;
        if (!started) return;
        if (closed) { await invoke("stop_language_service", { id: started.id }); return; }
        session = started; version = started.version; sent = initial;
        await flush();
        if (!closed) { status(`${serverName} 已连接 · F12 / Ctrl+单击查看定义`); void poll(); scheduleSemantic(); }
      } catch (e) { if (!closed) status(String(e)); }
    },
    destroy() {
      references.destroy(); rename.destroy(); closed = true; ++semanticGeneration; semanticPending=false; clearTimeout(semanticTimer); ++signatureGeneration; clearTimeout(signatureTimer); clearTimeout(changeTimer); clearTimeout(pollTimer);
      if (session) void invoke("stop_language_service", { id: session.id }).catch(() => {});
      session = null; view = null;
    },
  };
}
