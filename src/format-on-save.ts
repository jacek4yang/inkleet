import {snapshotText} from "./snapshot-text";
import {formatBinding} from "./command-registry";
import { Annotation, ChangeSet } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from "@codemirror/view";
const formatters=new WeakMap<EditorView,()=>void>(),savers=new WeakMap<EditorView,()=>void>();
export function saveDocument(view:EditorView){const run=savers.get(view);if(!run||view.composing)return false;run();return true;}
export function formatDocument(view:EditorView){const run=formatters.get(view);if(!run||view.composing)return false;run();return true;}
export const formattedTransaction=Annotation.define<boolean>();
type Options={epoch?:()=>number;ready?:(save:boolean)=>boolean;enabled:()=>boolean;save:(text:string)=>Promise<boolean>;request:(text:string)=>Promise<string>;report:(message:string)=>void};
export function formatOnSave(options:Options){
  class Controller{
    private generation=0;private closed=false;private busy=false;private pending:{generation:number;epoch:number;save:boolean}|null=null;
    private worker:Worker|null=null;private rejectDiff:((reason:Error)=>void)|null=null;
    private readonly trigger=()=>{void this.run(false);};
    private readonly saveTrigger=()=>{void this.run(true);};
    constructor(private view:EditorView){formatters.set(view,this.trigger);savers.set(view,this.saveTrigger);}
    update(update:ViewUpdate){
      if(!update.docChanged)return;
      ++this.generation;this.pending=null;this.cancelDiff();
    }
    cancelDiff(){this.worker?.terminate();this.worker=null;this.rejectDiff?.(Error("格式化版本已取消"));this.rejectDiff=null;}
    async run(save:boolean){
      if(this.closed||this.view.composing)return;
      if(options.ready?.(save)===false){if(save)options.report("请先处理保存错误或关闭对话框");return;}
      if(this.busy){this.pending={generation:this.generation,epoch:options.epoch?.()??0,save:save||!!(this.pending?.generation===this.generation&&this.pending.save)};return;}
      this.busy=true;this.pending=null;
      const doc=this.view.state.doc,text=snapshotText(doc),generation=this.generation,epoch=options.epoch?.()??0;
      let committedDoc:typeof doc|null=null;
      // Preserve an explicit Save across our own formatting transaction without
      // carrying that intention across user edits or workspace epochs.
      const mergeSaveIntent=()=>{
        const pending=this.pending;
        if(pending?.save&&pending.generation===generation&&pending.epoch===epoch){
          save=true;this.pending=null;
        }
      };
      const current=()=>epoch===(options.epoch?.()??0)&&options.ready?.(save)!==false&&!this.closed&&generation===this.generation&&this.view.state.doc===doc&&!this.view.composing;
      try{
        if(save&&!options.enabled()){if(!await options.save(text))throw Error("保存未完成，草稿仍被保留");options.report("");return;}
        if(new TextEncoder().encode(text).length>1024*1024)throw Error("格式化源码超过 1 MiB 限制");
        const after=(await options.request(text)).replace(/\r\n?/g,"\n");
        mergeSaveIntent();
        if(!current())return;
        if(after===text){if(save&&!await options.save(text))throw Error("保存未完成，草稿仍被保留");options.report("");return;}
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
        mergeSaveIntent();
        if(!current())return;
        if(!Array.isArray(changes)||changes.length>4096||changes.some(c=>!c||!Number.isInteger(c.from)||!Number.isInteger(c.to)||c.from<0||c.to<c.from||c.to>doc.length||typeof c.insert!=="string"))throw Error("格式化编辑无效");
        const changeSet=ChangeSet.of(changes,doc.length);
        if(changeSet.apply(doc).toString()!==after)throw Error("格式化差异校验失败");
        // All cursors map through the edits; do not restore stale captured selections.
        this.view.dispatch({changes:changeSet,annotations:[formattedTransaction.of(true),isolateHistory.of("full")],userEvent:"input.format"});
        committedDoc=this.view.state.doc;
        if(save&&!await options.save(after))throw Error("保存未完成，格式化后的草稿仍被保留");
        options.report("");
      }catch(error){
        mergeSaveIntent();
        if(!this.closed&&(current()||this.view.state.doc===committedDoc))options.report((save?"保存未完成 · ":"格式化未完成 · ")+String(error).slice(0,220));
      }
      finally{this.busy=false;const pending=this.takePending();if(pending&&!this.closed&&pending.generation===this.generation&&pending.epoch===(options.epoch?.()??0))void this.run(pending.save);}
    }
    takePending(){const pending=this.pending;this.pending=null;return pending;}
    destroy(){if(formatters.get(this.view)===this.trigger)formatters.delete(this.view);if(savers.get(this.view)===this.saveTrigger)savers.delete(this.view);this.closed=true;this.pending=null;++this.generation;this.cancelDiff();}
  }
  const plugin=ViewPlugin.fromClass(Controller);
  return [plugin,keymap.of([{key:"Mod-s",run:saveDocument},{key:formatBinding(navigator.platform),run:formatDocument}])];
}

