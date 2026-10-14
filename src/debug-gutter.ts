import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, keymap } from "@codemirror/view";
const toggle = StateEffect.define<number>({ map: (value, mapping) => mapping.mapPos(value) });
const stoppedAt = StateEffect.define<number>();
class Breakpoint extends GutterMarker {
  toDOM() { const dot = document.createElement("span"); dot.textContent = "●"; dot.title = "断点 · 点击取消，F9 切换当前行"; return dot; }
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
        value = effect.value > 0 && effect.value <= transaction.state.doc.lines
          ? Decoration.set([Decoration.line({ class: "cm-debug-stopped" }).range(transaction.state.doc.line(effect.value).from)]) : Decoration.none;
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
      EditorView.theme({ ".cm-debug-gutter": { color: "#bc4d43", width: "18px", cursor: "pointer" }, ".cm-debug-gutter .cm-gutterElement": { padding: "0 3px" }, ".cm-debug-stopped": { backgroundColor: "#e8bd4b35", boxShadow: "inset 3px 0 #bc8e22" } }),
    ],
    stopped(view: EditorView, line: number) {
      view.dispatch({ effects: stoppedAt.of(line) });
      if (line > 0 && line <= view.state.doc.lines) view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: "center" }) });
    },
  };
}
