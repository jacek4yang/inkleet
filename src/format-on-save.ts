import {formatBinding} from "./command-registry";
import { Annotation, ChangeSet } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from "@codemirror/view";
const formatters=new WeakMap<EditorView,()=>void>();
export function formatDocument(view:EditorView){const run=formatters.get(view);if(!run||view.composing)return false;run();return true;}
export const formattedTransaction=Annotation.define<boolean>();
type Options={enabled:()=>boolean;saved:(text:string)=>Promise<boolean>;request:(text:string)=>Promise<string>;report:(message:string)=>void};
export function formatOnSave(options:Options){
  class Controller{
    private timer:ReturnType<typeof setTimeout>|undefined;
    private generation=0;private closed=false;private busy=false;private pending:{generation:number;explicit:boolean}|null=null;
    private worker:Worker|null=null;private rejectDiff:((reason:Error)=>void)|null=null;
    private readonly trigger=()=>{void this.run(true);};
    constructor(private view:EditorView){formatters.set(view,this.trigger);}
    update(update:ViewUpdate){
      if(!update.docChanged)return;
      ++this.generation;this.pending=null;clearTimeout(this.timer);this.cancelDiff();
      if(update.transactions.some(t=>t.annotation(formattedTransaction)||t.isUserEvent("undo")||t.isUserEvent("redo")||t.isUserEvent("input.rename")))return;
      this.schedule();
    }
    schedule(){
      clearTimeout(this.timer);
      if(this.closed||!options.enabled())return;
      this.timer=setTimeout(()=>{void this.run(false);},1200);
    }
    cancelDiff(){this.worker?.terminate();this.worker=null;this.rejectDiff?.(Error("格式化版本已取消"));this.rejectDiff=null;}
    async run(explicit:boolean){
      clearTimeout(this.timer);
      if(this.closed||this.view.composing||(!explicit&&!options.enabled()))return;
      if(this.busy){this.pending={generation:this.generation,explicit:explicit||!!(this.pending?.generation===this.generation&&this.pending.explicit)};return;}
      this.busy=true;this.pending=null;
      const doc=this.view.state.doc,text=doc.toString(),generation=this.generation;
      const current=()=>!this.closed&&generation===this.generation&&this.view.state.doc===doc&&!this.view.composing&&(explicit||options.enabled());
      try{
        if(new TextEncoder().encode(text).length>1024*1024)throw Error("格式化源码超过 1 MiB 限制");
        if(!await options.saved(text)){if(explicit)options.report("请先处理保存失败或文件冲突");return;}
        if(!current())return;
        const after=(await options.request(text)).replace(/\r\n?/g,"\n");
        if(!current())return;
        if(after===text){options.report("");return;}
        const changes=await new Promise<unknown>((resolve,reject)=>{
          const worker=new Worker(new URL("./format.worker.ts",import.meta.url),{type:"module"});
          this.worker=worker;let done=false;
          const timeout=setTimeout(()=>finish(Error("格式化差异计算超时")),2000);
          const finish=(error?:Error,result?:unknown)=>{
            if(done)return;done=true;clearTimeout(timeout);worker.terminate();
            if(this.worker===worker){this.worker=null;this.rejectDiff=null;}
            error?reject(error):resolve(result);
          };
          this.rejectDiff=error=>finish(error);
          worker.onmessage=event=>event.data.error?finish(Error(event.data.error)):finish(undefined,event.data.changes);
          worker.onerror=()=>finish(Error("无法计算格式化差异"));
          worker.postMessage({before:text,after});
        });
        if(!current())return;
        if(!Array.isArray(changes)||changes.length>4096||changes.some(c=>!c||!Number.isInteger(c.from)||!Number.isInteger(c.to)||c.from<0||c.to<c.from||c.to>doc.length||typeof c.insert!=="string"))throw Error("格式化编辑无效");
        const changeSet=ChangeSet.of(changes,doc.length);
        if(changeSet.apply(doc).toString()!==after)throw Error("格式化差异校验失败");
        // All cursors map through the edits; do not restore stale captured selections.
        this.view.dispatch({changes:changeSet,annotations:[formattedTransaction.of(true),isolateHistory.of("full")],userEvent:"input.format"});
        options.report("");
      }catch(error){if(current())options.report("格式化未完成 · "+String(error).slice(0,220));}
      finally{this.busy=false;const pending=this.takePending();if(pending&&!this.closed&&pending.generation===this.generation)void this.run(pending.explicit);}
    }
    takePending(){const pending=this.pending;this.pending=null;return pending;}
    destroy(){if(formatters.get(this.view)===this.trigger)formatters.delete(this.view);this.closed=true;this.pending=null;++this.generation;clearTimeout(this.timer);this.cancelDiff();}
  }
  const plugin=ViewPlugin.fromClass(Controller);
  return [plugin,keymap.of([{key:"Mod-s",run:view=>{void view.plugin(plugin)?.run(true);return true;}},{key:formatBinding(navigator.platform),run:formatDocument}]),
    EditorView.domEventHandlers({compositionend(_event,view){view.plugin(plugin)?.schedule();return false;}})];
}
