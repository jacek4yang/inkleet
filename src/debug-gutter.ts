import { debugLocation, type DebugPosition } from "./debug-position";
import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, keymap, WidgetType } from "@codemirror/view";
const toggle = StateEffect.define<number>({ map: (value, mapping) => mapping.mapPos(value) });
const stoppedAt = StateEffect.define<DebugPosition|null>();
class Breakpoint extends GutterMarker {
  toDOM() { const dot = document.createElement("span"); const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 12 12");svg.setAttribute("width","12");svg.setAttribute("height","12");svg.setAttribute("aria-hidden","true");const circle=document.createElementNS(svg.namespaceURI,"circle");circle.setAttribute("cx","6");circle.setAttribute("cy","6");circle.setAttribute("r","4");circle.setAttribute("fill","currentColor");svg.append(circle);dot.append(svg); dot.title = "断点 · 点击取消，F9 切换当前行"; return dot; }
}
function arrowSvg(inline=false){
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox",inline?"0 0 10 10":"0 0 14 14");svg.setAttribute("width",inline?"8":"14");svg.setAttribute("height",inline?"8":"14");svg.setAttribute("aria-hidden","true");
  const path=document.createElementNS(svg.namespaceURI,"path");path.setAttribute("d",inline?"M1 2h8L5 8Z":"M1.5 4.5h5V1.5l6 5.5-6 5.5V9.5h-5Z");path.setAttribute("fill","currentColor");path.setAttribute("stroke","var(--surface-editor,white)");path.setAttribute("stroke-width","1");path.setAttribute("stroke-linejoin","round");svg.append(path);return svg;
}
class ExecutionMarker extends GutterMarker{
  constructor(readonly execution:boolean){super();}
  eq(other:ExecutionMarker){return other.execution===this.execution;}
  toDOM(){const node=document.createElement("span");node.className=this.execution?"cm-execution-pointer":"cm-inspection-pointer";node.title=this.execution?"当前执行位置":"正在查看的调用帧";node.setAttribute("aria-label",node.title);node.append(arrowSvg());return node;}
}
class PositionMarker extends WidgetType {
  constructor(readonly execution:boolean,readonly column:number){super();}
  eq(other:PositionMarker){return other.execution===this.execution&&other.column===this.column;}
  toDOM(){const node=document.createElement("span");node.className="cm-debug-column"+(this.execution?"":" cm-inspection-column");node.dataset.debugColumn=String(this.column);node.title=this.execution?"调试器报告的执行列":"调用帧位置";node.setAttribute("aria-label",node.title);node.append(arrowSvg(true));return node;}
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
  const pointer=StateField.define<RangeSet<GutterMarker>>({
    create:()=>RangeSet.empty,
    update(value,transaction){
      if(transaction.docChanged)value=RangeSet.empty;
      for(const effect of transaction.effects)if(effect.is(stoppedAt)){
        const location=debugLocation(transaction.state.doc,effect.value);
        value=location?RangeSet.of([new ExecutionMarker(effect.value!.execution).range(transaction.state.doc.line(location.line).from)]):RangeSet.empty;
      }
      return value;
    }
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
          marks.push(Decoration.widget({widget:new PositionMarker(execution,effect.value!.column!),side:-1}).range(location.from));
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
      points, line, pointer,
      gutter({class:"cm-execution-gutter",markers:view=>view.state.field(pointer),initialSpacer:()=>new ExecutionMarker(true)}),
      gutter({ class: "cm-debug-gutter", markers: view => view.state.field(points), initialSpacer: () => dot,
        domEventHandlers: { mousedown(view, line) { toggleLine(view, line.from); return true; } } }),
      keymap.of([{ key: "F9", run(view) { toggleLine(view, view.state.doc.lineAt(view.state.selection.main.head).from); return true; } }]),
      EditorView.updateListener.of(update => {
        if (update.docChanged || update.transactions.some(t => t.effects.some(e => e.is(toggle)))) {
          const lines: number[] = []; update.state.field(points).between(0, update.state.doc.length, from => { lines.push(update.state.doc.lineAt(from).number); });
          onChange([...new Set(lines)]);
        }
      }),
      EditorView.theme({ ".cm-debug-gutter": { color: "#bc4d43", width: "18px", cursor: "pointer" }, ".cm-debug-gutter .cm-gutterElement": { padding: "0 3px" }, ".cm-execution-gutter":{width:"16px",color:"#ab7816"}, ".cm-execution-gutter .cm-gutterElement":{padding:"0 1px"}, ".cm-execution-pointer,.cm-inspection-pointer":{display:"inline-flex",verticalAlign:"middle"}, ".cm-inspection-pointer":{color:"#64849f"}, ".cm-debug-column": {display:"inline-block",width:"0",height:"0",position:"relative",color:"#ab7816",pointerEvents:"none"}, ".cm-inspection-column":{color:"#64849f"}, ".cm-debug-column svg":{position:"absolute",left:"-4px",top:"-21px"}, ".cm-debug-range": {backgroundColor:"#e7bd4b66",textDecoration:"underline",textDecorationColor:"#956a12",textUnderlineOffset:"3px"}, ".cm-debug-frame": {backgroundColor:"#7891ac22",boxShadow:"inset 3px 0 #7891ac"}, ".cm-debug-frame-range": {backgroundColor:"#7891ac44",textDecoration:"underline"}, ".cm-debug-stopped": { backgroundColor: "#e8bd4b35", boxShadow: "inset 3px 0 #bc8e22" } }),
    ],
    stopped(view: EditorView, position: DebugPosition|null) {
      const line=position?.line??0;
      view.dispatch({ effects: stoppedAt.of(position) });
      if (line > 0 && line <= view.state.doc.lines) view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: "center" }) });
    },
  };
}
