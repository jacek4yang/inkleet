/** A small shared action model. Controllers retain their own safety/version guards. */
export type Command<C>={id:string;label:string;key?:string;enabled?:(context:C)=>boolean;run:(context:C)=>boolean};
export class CommandRegistry<C>{
  private entries=new Map<string,Command<C>>();
  register(command:Command<C>){
    if(this.entries.has(command.id))throw Error("Duplicate command: "+command.id);
    if(command.key&&[...this.entries.values()].some(c=>c.key===command.key))throw Error("Conflicting binding: "+command.key);
    this.entries.set(command.id,command);
    return ()=>{if(this.entries.get(command.id)===command)this.entries.delete(command.id);};
  }
  list(context:C,query=""){
    const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return [...this.entries.values()].filter(c=>(!c.enabled||c.enabled(context))&&words.every(w=>(c.label+" "+c.id).toLocaleLowerCase().includes(w)));
  }
  execute(id:string,context:C){
    const command=this.entries.get(id);
    return !!command&&(!command.enabled||command.enabled(context))&&command.run(context);
  }
}
export function editorPlatform(platform:string):"mac"|"linux"|"windows"{
  return /mac|iphone|ipad/i.test(platform)?"mac":/linux/i.test(platform)?"linux":"windows";
}
export function formatBinding(platform:string){return editorPlatform(platform)==="linux"?"Ctrl-Shift-i":"Alt-Shift-f";}
