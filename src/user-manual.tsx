import React,{useLayoutEffect,useRef} from "react";
import {IconButton} from "./icons";
import {MarkdownPreview} from "./notes";
import text from "../docs/USER_MANUAL.md?raw";
export function UserManual({onClose}:{onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),opener=useRef(document.activeElement as HTMLElement|null);
 useLayoutEffect(()=>{dialog.current!.showModal();return()=>{dialog.current?.close();if(opener.current?.isConnected)opener.current.focus();};},[]);
 return <dialog ref={dialog} className="user-manual" aria-label="使用手册" onCancel={event=>{event.preventDefault();onClose();}}>
 <header><h2>使用手册</h2><IconButton icon="close" label="关闭使用手册" onClick={onClose}/></header><MarkdownPreview text={text}/></dialog>;
}