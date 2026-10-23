import {RangeSetBuilder,StateEffect,type Extension} from "@codemirror/state";
import {Decoration,EditorView,ViewPlugin,type DecorationSet,type ViewUpdate} from "@codemirror/view";
import {getIndentUnit} from "@codemirror/language";
export function indentationColumns(text:string,tabSize:number,max=128){
  let columns=0;
  for(let i=0;i<Math.min(text.length,4096);i++){
    if(text[i]===" ")columns++;else if(text[i]==="\t")columns+=tabSize-columns%tabSize;else return {columns:Math.min(columns,max),blank:false};
    if(columns>=max)return {columns:max,blank:false};
  }
  return {columns,blank:text.length<=4096};
}
const refresh=StateEffect.define<null>();
type Row={from:number;number:number;columns:number;blank:boolean};
export const indentGuides:Extension=[
  ViewPlugin.fromClass(class{
    decorations:DecorationSet=Decoration.none;closed=false;frame=0;
    constructor(readonly view:EditorView){this.build();this.measure();}
    measure(){this.view.requestMeasure({key:this,read:()=>{const line=this.view.contentDOM.querySelector(".cm-line");return line?getComputedStyle(line).paddingLeft:"6px";},write:value=>{if(!this.closed)this.view.dom.style.setProperty("--indent-guide-inset",value);}});}
    build(){
      const state=this.view.state,unit=Math.max(1,getIndentUnit(state)),rows:Row[]=[],seen=new Set<number>();
      for(const visible of this.view.visibleRanges){
        for(let pos=visible.from;pos<=visible.to;){
          const line=state.doc.lineAt(pos);
          if(!seen.has(line.from)){seen.add(line.from);rows.push({from:line.from,number:line.number,...indentationColumns(line.text,state.tabSize)});}
          if(line.to>=visible.to)break;pos=line.to+1;
        }
      }
      rows.sort((a,b)=>a.from-b.from);
      for(let i=0;i<rows.length;i++)if(rows[i].blank&&rows[i].columns===0){
        let before:Row|undefined,after:Row|undefined;
        for(let j=i-1;j>=0&&i-j<=8;j--){if(rows[j+1].number!==rows[j].number+1)break;if(!rows[j].blank){before=rows[j];break;}}
        for(let j=i+1;j<rows.length&&j-i<=8;j++){if(rows[j].number!==rows[j-1].number+1)break;if(!rows[j].blank){after=rows[j];break;}}
        if(before&&after)rows[i].columns=Math.min(before.columns,after.columns);
      }
      const cursor=state.doc.lineAt(state.selection.main.head).number,index=rows.findIndex(r=>r.number===cursor);
      const depth=index>=0?Math.ceil(rows[index].columns/unit):0;
      let start=index,end=index;
      if(depth){while(start>0&&rows[start].number===rows[start-1].number+1&&rows[start-1].columns>(depth-1)*unit)start--;while(end+1<rows.length&&rows[end+1].number===rows[end].number+1&&rows[end+1].columns>(depth-1)*unit)end++;}
      const result=new RangeSetBuilder<Decoration>();
      for(let i=0;i<rows.length;i++){
        const row=rows[i],count=Math.min(32,Math.ceil(row.columns/unit));if(!count)continue;
        result.add(row.from,row.from,Decoration.line({attributes:{class:"cm-indent-guides"+(depth&&i>=start&&i<=end?" cm-indent-guide-active":""),style:"--indent-guide-width:"+(count*unit)+";--indent-guide-unit:"+unit+";--indent-guide-active:"+((depth-1)*unit)}}));
      }
      this.decorations=result.finish();
    }
    update(update:ViewUpdate){
      if(update.view.composing){this.decorations=this.decorations.map(update.changes);return;}
      if(update.docChanged||update.viewportChanged||update.geometryChanged||update.selectionSet||update.startState.tabSize!==update.state.tabSize||getIndentUnit(update.startState)!==getIndentUnit(update.state)||update.transactions.some(t=>t.effects.some(e=>e.is(refresh))))this.build();
      if(update.geometryChanged)this.measure();
    }
    destroy(){this.closed=true;cancelAnimationFrame(this.frame);this.view.dom.style.removeProperty("--indent-guide-inset");}
  },{decorations:v=>v.decorations,eventHandlers:{compositionend(){cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>{if(!this.closed)this.view.dispatch({effects:refresh.of(null)});});}}}),
  EditorView.baseTheme({
    ".cm-indent-guides":{position:"relative"},
    ".cm-indent-guides::before":{content:'""',position:"absolute",pointerEvents:"none",left:"var(--indent-guide-inset,6px)",top:"0",bottom:"0",width:"calc(var(--indent-guide-width) * 1ch)",backgroundImage:"repeating-linear-gradient(to right, color-mix(in srgb, currentColor 14%, transparent) 0, color-mix(in srgb, currentColor 14%, transparent) 1px, transparent 1px, transparent calc(var(--indent-guide-unit) * 1ch))"},
    ".cm-indent-guide-active::after":{content:'""',position:"absolute",pointerEvents:"none",left:"calc(var(--indent-guide-inset,6px) + var(--indent-guide-active) * 1ch)",top:"0",bottom:"0",width:"1px",backgroundColor:"color-mix(in srgb, currentColor 32%, transparent)"},
  }),
];
