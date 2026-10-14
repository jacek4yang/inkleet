import { debugLocation, type DebugPosition } from "./debug-position";
import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, keymap, WidgetType } from "@codemirror/view";
const toggle = StateEffect.define<number>({ map: (value, mapping) => mapping.mapPos(value) });
const stoppedAt = StateEffect.define<DebugPosition|null>();
class Breakpoint extends GutterMarker {
  toDOM() { const dot = document.createElement("span"); dot.textContent = "●"; dot.title = "断点 · 点击取消，F9 切换当前行"; return dot; }
}
class PositionMarker extends WidgetType {
  constructor(readonly execution:boolean){super();}
  eq(other:PositionMarker){return other.execution===this.execution;}
  toDOM(){const node=document.createElement("span");node.className="cm-debug-column";node.title=this.execution?"调试器报告的执行列":"调用帧位置";node.setAttribute("aria-label",node.title);return node;}
}
const dot = new Breakpoint();
export function debugGutter(initial: number[], onChange: (lines: number[]) => void) {
  const points = StateField.define<RangeSet<GutterMarker>>({
    create(state) { return RangeSet.of([...new Set(initial)].filter(n => n > 0 && n <= state.doc.lines).sort((a,b) => a-b).map(n => dot.range(state.doc.line(n).from))); },
    update(value, transaction) {
      value = value.map(transaction.changes);
      if (transaction.docChanged) {
        const starts = new Set<number>();
        value.between(0, transaction.state.doc.length, from => { starts.add(transaction.state.doc.lineAt(from).from); });
        value = RangeSet.of([...starts].sort((a,b) => a-b).map(from => dot.range(from)));
      }
      for (const effect of transaction.effects) if (effect.is(toggle)) {
        let found = false; value.between(effect.value, effect.value, () => { found = true; });
        value = found ? value.update({ filter: from => from !== effect.value }) : value.update({ add: [dot.range(effect.value)] });
      }
      return value;
    },
  });
  const line = StateField.define({
    create: () => Decoration.none,
    update(value, transaction) {
      if (transaction.docChanged) value = Decoration.none;
      for (const effect of transaction.effects) if (effect.is(stoppedAt)) {
        const location=debugLocation(transaction.state.doc,effect.value);
        if(!location){value=Decoration.none;continue;}
        const execution=effect.value!.execution;
        const marks=[Decoration.line({class:execution?"cm-debug-stopped":"cm-debug-frame"}).range(transaction.state.doc.line(location.line).from)];
        if(location.from!==undefined){
          if(location.to!==undefined)marks.push(Decoration.mark({class:execution?"cm-debug-range":"cm-debug-frame-range",attributes:{title:execution?"调试器报告的执行范围":"调用帧范围"}}).range(location.from,location.to));
          else marks.push(Decoration.widget({widget:new PositionMarker(execution),side:1}).range(location.from));
        }
        value=Decoration.set(marks,true);
      }
      return value;
    },
    provide: field => EditorView.decorations.from(field),
  });
  function toggleLine(view: EditorView, position: number) { view.dispatch({ effects: toggle.of(position) }); }
  return {
    extensions: [
      points, line,
      gutter({ class: "cm-debug-gutter", markers: view => view.state.field(points), initialSpacer: () => dot,
        domEventHandlers: { mousedown(view, line) { toggleLine(view, line.from); return true; } } }),
      keymap.of([{ key: "F9", run(view) { toggleLine(view, view.state.doc.lineAt(view.state.selection.main.head).from); return true; } }]),
      EditorView.updateListener.of(update => {
        if (update.docChanged || update.transactions.some(t => t.effects.some(e => e.is(toggle)))) {
          const lines: number[] = []; update.state.field(points).between(0, update.state.doc.length, from => { lines.push(update.state.doc.lineAt(from).number); });
          onChange([...new Set(lines)]);
        }
      }),
      EditorView.theme({ ".cm-debug-gutter": { color: "#bc4d43", width: "18px", cursor: "pointer" }, ".cm-debug-gutter .cm-gutterElement": { padding: "0 3px" }, ".cm-debug-column": { display:"inline-block", width:"0", height:"1.1em", borderLeft:"2px solid #a66b00", verticalAlign:"text-bottom" }, ".cm-debug-range": {backgroundColor:"#e7bd4b66",textDecoration:"underline",textDecorationColor:"#956a12",textUnderlineOffset:"3px"}, ".cm-debug-frame": {backgroundColor:"#7891ac22",boxShadow:"inset 3px 0 #7891ac"}, ".cm-debug-frame-range": {backgroundColor:"#7891ac44",textDecoration:"underline"}, ".cm-debug-stopped": { backgroundColor: "#e8bd4b35", boxShadow: "inset 3px 0 #bc8e22" } }),
    ],
    stopped(view: EditorView, position: DebugPosition|null) {
      const line=position?.line??0;
      view.dispatch({ effects: stoppedAt.of(position) });
      if (line > 0 && line <= view.state.doc.lines) view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: "center" }) });
    },
  };
}
