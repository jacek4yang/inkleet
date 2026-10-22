/** Additional shortcuts never replace text-entry keys or existing defaults. */
export const commandChoices=[
 ["workbench.settings","打开设置"],["workbench.catalogue","打开中国站题库"],["workbench.link","通过链接打开题目"],
 ["workbench.focus","切换专注布局"],["workbench.notes","显示笔记"],["workbench.code","显示代码"],
 ["workbench.local","打开本地运行面板"],["workbench.environment","管理开发环境"],["workbench.manual","使用手册"],
 ["editor.save","保存当前文档"],["editor.goBack","返回代码位置"],["editor.goForward","前进代码位置"],
 ["editor.undo","撤销"],["editor.redo","重做"],["editor.selectAll","全选"],["editor.rename","重命名符号"],
 ["editor.implementation","转到实现"],["editor.definition","转到定义"],["editor.references","查找引用"],
 ["editor.signature","参数提示"],["editor.completion","触发补全"],["editor.format","格式化文档"],
 ["debug.toggleBreakpoint","切换断点"],
] as const;
export type BindableCommand=typeof commandChoices[number][0];
export type UserKeybindings=Partial<Record<BindableCommand,string>>;
export const shortcutChoices=Array.from("abcdefghijklmnopqrstuvwxyz",letter=>["Mod-Alt-"+letter,"Mod-Alt-Shift-"+letter]).flat();
export function validateKeybindings(value:unknown):asserts value is UserKeybindings{
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("keybindings 必须为对象");
 const used=new Set<string>();
 for(const [id,key] of Object.entries(value)){
  if(!commandChoices.some(([command])=>command===id))throw Error("不支持的命令："+id);
  if(typeof key!=="string"||!shortcutChoices.includes(key))throw Error("快捷键使用 Mod-Alt-a 到 z，或 Mod-Alt-Shift-a 到 z");
  if(used.has(key))throw Error("快捷键冲突："+key);
  used.add(key);
 }
}
export function matchUserShortcut(event:KeyboardEvent,key:string,mac:boolean):boolean{
 if(event.isComposing||event.keyCode===229||event.repeat||event.getModifierState("AltGraph"))return false;
 return event.altKey&&event.shiftKey===key.includes("-Shift-")&&
  (mac?event.metaKey&&!event.ctrlKey:event.ctrlKey&&!event.metaKey)&&event.key.toLowerCase()===key.slice(-1);
}
