import { isolateHistory } from "@codemirror/commands";
import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";

type Request = (pos: number, doc: Text, name: string) => Promise<unknown>;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function offset(doc: Text, value: unknown) {
  if (!object(value) || !Number.isInteger(value.line) || !Number.isInteger(value.character) || value.line < 0 || value.line >= doc.lines || value.character < 0) return null;
  const line = doc.line(value.line + 1);
  if (value.character > line.length) return null;
  const column = value.character;
  if (column > 0 && column < line.length && /[\uD800-\uDBFF]/.test(line.text[column - 1]) && /[\uDC00-\uDFFF]/.test(line.text[column])) return null;
  return line.from + column;
}
function edits(doc: Text, value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 512) throw new Error("没有可应用的重命名结果");
  let size = 0;
  const changes = value.map(item => {
    if (!object(item) || !object(item.range) || typeof item.newText !== "string" || item.newText.length > 65536) throw new Error("重命名结果格式无效");
    const from = offset(doc, item.range.start), to = offset(doc, item.range.end);
    if (from === null || to === null || from > to) throw new Error("重命名范围无效");
    size += item.newText.length;
    return { from, to, insert: item.newText };
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  if (size > 2 * 1024 * 1024) throw new Error("重命名结果过大");
  for (let i = 1; i < changes.length; i++) if (changes[i].from < changes[i - 1].to || changes[i].from === changes[i - 1].from) throw new Error("重命名编辑重叠");
  return changes;
}

/** F2 performs one undoable, version-checked edit of the current source only. */
export function renameSymbol(request: Request, status: (text: string) => void) {
  const effect = StateEffect.define<Tooltip | null>();
  let generation = 0, destroyed = false;
  const field = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, transaction) {
      if (transaction.docChanged) { ++generation; value = null; }
      for (const e of transaction.effects) if (e.is(effect)) value = e.value;
      return value;
    },
    provide: f => showTooltip.from(f),
  });
  function open(view: EditorView) {
    if(view.composing)return false;
    const doc = view.state.doc, pos = view.state.selection.main.head, line = doc.lineAt(pos);
    const symbol = [...line.text.matchAll(/[\p{L}\p{N}_$]+/gu)].find(m => pos >= line.from + m.index! && pos <= line.from + m.index! + m[0].length);
    if (!symbol) { status("请将光标放在要重命名的符号上"); return true; }
    const token = ++generation;
    function dismiss() { ++generation; if (!destroyed) { view.dispatch({ effects: effect.of(null) }); view.focus(); } }
    view.dispatch({ effects: effect.of({ pos, above: true, create() {
      const dom = document.createElement("form"); dom.className = "lsp-rename"; dom.setAttribute("aria-label", "重命名符号");
      const label = document.createElement("label"); label.textContent = "新名称";
      const input = document.createElement("input"); input.value = symbol[0]; input.maxLength = 128; input.setAttribute("aria-label", "新名称"); input.autocomplete = "off"; input.spellcheck = false; label.append(input);
      const apply = document.createElement("button"); apply.type = "submit"; apply.textContent = "重命名";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "取消"; cancel.onclick = dismiss;
      const error = document.createElement("p"); error.setAttribute("role", "alert");
      dom.append(label, apply, cancel, error);
      let pending = false, composing = false;
      input.addEventListener("compositionstart",()=>{composing=true;});input.addEventListener("compositionend",()=>{composing=false;});
      dom.onkeydown = event => { event.stopPropagation(); if(event.isComposing||event.keyCode===229)return; if (event.key === "Escape") { event.preventDefault(); dismiss(); } };
      dom.onsubmit = async event => {
        event.preventDefault(); if (pending || composing || view.composing) return;
        const name = input.value.trim();
        if (!name || !/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name)) { error.textContent = "请输入有效的标识符"; return; }
        if (name === symbol[0]) { dismiss(); return; }
        pending = true; apply.disabled = true; input.disabled = true; error.textContent = "";
        try {
          const response = await request(pos, doc, name);
          if (destroyed || token !== generation || view.state.doc !== doc) return;
          const changes = edits(doc, response);
          ++generation;
          view.dispatch({ changes, effects: effect.of(null), annotations: isolateHistory.of("full"), userEvent: "input.rename" });
          view.focus(); status("已重命名 " + changes.length + " 处 · Ctrl+Z 撤销");
        } catch (e) {
          if (!destroyed && token === generation && view.state.doc === doc) error.textContent = String(e).slice(0, 500);
        } finally {
          if (!destroyed && token === generation && dom.isConnected) { pending = false; apply.disabled = false; input.disabled = false; input.focus(); }
        }
      };
      return { dom, mount() { input.focus(); input.select(); } };
    } }) });
    return true;
  }
  const extensions: Extension[] = [field, keymap.of([{ key: "F2", run: open }])];
  return { extensions, open, destroy() { destroyed = true; ++generation; } };
}
