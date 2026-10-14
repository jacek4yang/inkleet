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

/** F2 is fast; Shift+Enter previews one exact, version-checked source edit. */
export function renameSymbol(
  request: Request, status: (text: string) => void, keybindings=true,
  captureValidity: () => (() => boolean) = () => () => true,
) {
  const effect = StateEffect.define<Tooltip | null>();
  let generation = 0, destroyed = false;
  let invalidated = () => {};
  const field = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, transaction) {
      if (transaction.docChanged) { if(value)invalidated(); ++generation; value = null; }
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
    const originalName=symbol[0];
    const token = ++generation, sessionCurrent=captureValidity();
    const current=()=>!destroyed&&token===generation&&view.state.doc===doc&&sessionCurrent();
    let owned:HTMLElement|null=null;
    invalidated=()=>{if(owned?.contains(document.activeElement))queueMicrotask(()=>{if(!destroyed&&!view.state.field(field)&&document.activeElement===document.body)view.focus();});};
    function dismiss() {
      const restore=!!owned?.contains(document.activeElement);
      ++generation;
      if (!destroyed) { view.dispatch({ effects: effect.of(null) }); if(restore)view.focus(); }
    }
    view.dispatch({ effects: effect.of({ pos, above: true, create() {
      const dom = document.createElement("form"); owned=dom; dom.className = "lsp-rename"; dom.setAttribute("aria-label", "重命名符号");
      const editing=document.createElement("div");
      const label = document.createElement("label"); label.textContent = "新名称";
      const input = document.createElement("input"); input.value = originalName; input.maxLength = 128; input.setAttribute("aria-label", "新名称"); input.autocomplete = "off"; input.spellcheck = false; label.append(input);
      const apply = document.createElement("button"); apply.type = "submit"; apply.textContent = "重命名";
      const preview = document.createElement("button"); preview.type="button"; preview.textContent="预览"; preview.title="Shift+Enter";
      editing.append(label,apply,preview);
      const review=document.createElement("section"); review.className="lsp-rename-preview";review.hidden=true;review.setAttribute("aria-label","重命名预览");
      const heading=document.createElement("div");heading.className="lsp-rename-summary";heading.tabIndex=-1;
      const rows=document.createElement("div");rows.className="lsp-rename-changes";
      const commit=document.createElement("button");commit.type="button";commit.textContent="应用";
      const back=document.createElement("button");back.type="button";back.textContent="返回";
      review.append(heading,rows,commit,back);
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "取消"; cancel.onclick = dismiss;
      const error = document.createElement("p"); error.setAttribute("role", "alert");
      dom.append(editing,review,cancel,error);
      let pending = false, composing = false, proposed:ReturnType<typeof edits>|null=null;
      function applyChanges(changes:ReturnType<typeof edits>){
        if(!current()||composing||view.composing){proposed=null;dismiss();return;}
        const restore=dom.contains(document.activeElement);
        proposed=null;++generation;
        view.dispatch({changes,effects:effect.of(null),annotations:isolateHistory.of("full"),userEvent:"input.rename"});
        if(restore)view.focus();
        status("已重命名 " + changes.length + " 处");
      }
      function showPreview(changes:ReturnType<typeof edits>){
        let size=0;
        for(const change of changes){size+=change.to-change.from+change.insert.length;if(size>131072)throw Error("预览超过大小限制，请缩小重命名范围");}
        rows.replaceChildren();
        for(const change of changes){
          const row=document.createElement("div");row.className="lsp-rename-change";
          const location=document.createElement("span");const sourceLine=doc.lineAt(change.from);location.textContent=sourceLine.number+":"+(change.from-sourceLine.from+1);
          const before=document.createElement("pre");before.className="lsp-rename-before";before.setAttribute("aria-label","原文本");before.textContent=doc.sliceString(change.from,change.to);
          const after=document.createElement("pre");after.className="lsp-rename-after";after.setAttribute("aria-label","新文本");after.textContent=change.insert;
          row.append(location,before,after);rows.append(row);
        }
        const restore=dom.contains(document.activeElement);
        proposed=changes;heading.textContent="本题源码 · "+changes.length+" 处修改";
        editing.hidden=true;review.hidden=false;if(restore)heading.focus();
      }
      async function submit(previewOnly:boolean){
        if(pending||composing||view.composing||!current()||!review.hidden)return;
        const name=input.value.trim();
        if(!name||new TextEncoder().encode(name).length>128||!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name)){error.textContent="请输入有效的标识符（最多 128 字节）";return;}
        if(name===originalName){dismiss();return;}
        if(dom.contains(document.activeElement))input.focus();
        pending=true;apply.disabled=true;preview.disabled=true;input.readOnly=true;error.textContent="";
        try{
          const response=await request(pos,doc,name);
          if(!current())return;
          const changes=edits(doc,response);
          if(previewOnly)showPreview(changes);else applyChanges(changes);
        }catch(e){if(current())error.textContent=String(e).slice(0,500);}
        finally{
          if(current()&&dom.isConnected){
            pending=false;apply.disabled=false;preview.disabled=false;input.readOnly=false;
            if(review.hidden&&dom.contains(document.activeElement))input.focus();
          }
        }
      }
      input.addEventListener("compositionstart",()=>{composing=true;});
      input.addEventListener("compositionend",()=>{composing=false;});
      dom.onkeydown=event=>{
        event.stopPropagation();
        if(event.isComposing||event.keyCode===229||composing){if(event.key==="Enter")event.preventDefault();return;}
        if(event.key==="Escape"){event.preventDefault();dismiss();return;}
        if(event.key==="Enter"&&event.repeat){event.preventDefault();return;}
        if(event.key==="Enter"&&event.shiftKey&&review.hidden){event.preventDefault();void submit(true);}
      };
      dom.onsubmit=event=>{event.preventDefault();void submit(false);};
      preview.onclick=()=>{void submit(true);};
      commit.onclick=()=>{if(proposed)applyChanges(proposed);};
      back.onclick=()=>{proposed=null;review.hidden=true;editing.hidden=false;error.textContent="";input.focus();input.select();};
      return {dom,mount(){input.focus();input.select();},destroy(){proposed=null;owned=null;}};
    } }) });
    return true;
  }
  const extensions: Extension[] = [field, ...(keybindings?[keymap.of([{ key: "F2", run: open }])]:[])];
  return { extensions, open, destroy() { destroyed = true; ++generation; } };
}
