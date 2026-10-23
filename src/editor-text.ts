/** CodeMirror's default document model uses LF; storage baselines remain byte-exact. */
export function editorText(text:string):string{return text.replace(/\r\n?/g,"\n");}
export function hasRecoveryEdits(draft:{text:string;baseline:string|null}|null|undefined,disk:string|null,initial?:string):boolean{
 return !!draft&&editorText(draft.text)!==editorText(draft.baseline??"")&&((disk??initial)===undefined||editorText(draft.text)!==editorText((disk??initial)!));
}
