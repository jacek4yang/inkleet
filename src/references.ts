import { Prec, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";

type Request = (pos: number, doc: Text) => Promise<unknown>;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
function point(doc: Text, value: unknown): number | null {
  if (!object(value) || !Number.isInteger(value.line) || !Number.isInteger(value.character) || value.line < 0 || value.line >= doc.lines || value.character < 0) return null;
  const line = doc.line(value.line + 1), c = value.character;
  if (c > line.length || (c > 0 && c < line.length && /[\uD800-\uDBFF]/.test(line.text[c - 1]) && /[\uDC00-\uDFFF]/.test(line.text[c]))) return null;
  return line.from + c;
}
/** Semantic references of the editable solution only; no hidden filesystem reads. */
export function findReferences(request: Request, status: (text: string) => void, keybindings=true) {
  const effect = StateEffect.define<Tooltip | null>();
  let generation = 0, destroyed = false, pending = false;
  let popup:HTMLElement|null=null;
  const field = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, tr) {
      if (tr.docChanged || tr.selection) { ++generation; pending = false; value = null; }
      for (const e of tr.effects) if (e.is(effect)) value = e.value;
      return value;
    },
    provide: f => showTooltip.from(f),
  });
  function close(view: EditorView) {
    const active = pending || !!view.state.field(field);
    const wasPending=pending;
    ++generation; pending = false;
    if(wasPending)status("");
    if (!destroyed) view.dispatch({ effects: effect.of(null) });
    return active;
  }
  async function open(view: EditorView) {
    if (view.composing) return;
    const doc = view.state.doc, pos = view.state.selection.main.head, token = ++generation;
    pending = true; view.dispatch({ effects: effect.of(null) });
    status("正在查找本题引用…");
    try {
      const result = await request(pos, doc);
      if (destroyed || token !== generation || view.state.doc !== doc || !view.hasFocus || view.composing) return;
      if (!object(result) || !Array.isArray(result.locations) || result.locations.length > 500) throw new Error("引用结果格式无效");
      const spans: { from: number; to: number }[] = [];
      for (const location of result.locations) {
        if (!object(location) || !object(location.range)) throw new Error("引用范围无效");
        const from = point(doc, location.range.start), to = point(doc, location.range.end);
        if (from === null || to === null || from > to) throw new Error("引用范围越界");
        if (!spans.some(s => s.from === from && s.to === to)) spans.push({ from, to });
      }
      spans.sort((a, b) => a.from - b.from || a.to - b.to);
      const omitted = Number.isSafeInteger(result.omitted) && result.omitted > 0 ? result.omitted : 0;
      const summary = "本题 " + spans.length + " 处引用（含声明）" + (omitted ? " · 已省略 " + omitted + " 处外部或辅助位置" : "");
      status(summary);
      if (!spans.length) return;
      view.dispatch({ effects: effect.of({ pos, above: true, create() {
        const dom = document.createElement("section"); popup=dom; dom.className = "lsp-references"; dom.setAttribute("aria-label", "本题引用");
        const header = document.createElement("div"), title = document.createElement("strong"); title.textContent = summary;
        const dismiss = document.createElement("button"); dismiss.type = "button"; dismiss.textContent = "关闭引用"; dismiss.onclick = () => { close(view); view.focus(); };
        header.append(title, dismiss); dom.append(header);
        const list = document.createElement("div"); list.className = "lsp-reference-list";
        for (const span of spans) {
          const line = doc.lineAt(span.from), button = document.createElement("button");
          button.type = "button"; button.dataset.referenceLine = String(line.number);
          button.textContent = line.number + ":" + (span.from - line.from + 1) + "  " + line.text.trim().slice(0, 240);
          button.onclick = () => {
            if (destroyed || token !== generation || view.state.doc !== doc) return;
            close(view);
            view.dispatch({ selection: { anchor: span.from, head: span.to }, effects: EditorView.scrollIntoView(span.from, { y: "center" }) });
            view.focus();
          };
          list.append(button);
        }
        dom.append(list);
        dom.onkeydown = event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(view); view.focus(); }
        };
        return { dom, mount() {
          if(!destroyed&&token===generation&&view.state.doc===doc&&view.hasFocus&&!view.composing)list.querySelector("button")?.focus();
        }, destroy(){if(popup===dom)popup=null;} };
      } }) });
    } catch (error) {
      if (!destroyed && token === generation && view.state.doc === doc && view.hasFocus && !view.composing) status("查找引用失败：" + String(error).slice(0, 300));
    } finally { if (token === generation) pending = false; }
  }
  const extensions: Extension[] = [field, EditorView.domEventObservers({
    compositionstart(_event,view){if(pending||view.state.field(field))close(view);},
    blur(event,view){
      if(event.relatedTarget instanceof Node&&popup?.contains(event.relatedTarget))return;
      if(pending||view.state.field(field))close(view);
    },
  }), Prec.highest(keymap.of([
    ...(keybindings?[{ key: "Shift-F12", run(view:EditorView) { void open(view); return true; } }]:[]),
    { key: "Escape", run: close },
  ]))];
  return { extensions, open, destroy() { destroyed = true; ++generation; pending = false; } };
}
