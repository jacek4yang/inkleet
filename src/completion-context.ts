import type {Text} from "@codemirror/state";
export type CompletionTrigger={triggerKind:1|2|3;triggerCharacter?:string};
export type IncompleteContext={doc:Text;from:number;pos:number;session:number};
export const identifierTail=/[\p{ID_Continue}$]*$/u;
export function completionTrigger(explicit:boolean,before:string,triggers:readonly string[],incomplete:boolean):CompletionTrigger{
  if(explicit)return {triggerKind:1};
  const character=Array.from(before).at(-1);
  if(character&&triggers.includes(character))return {triggerKind:2,triggerCharacter:character};
  return {triggerKind:incomplete?3:1};
}
export function advanceIncomplete(previous:IncompleteContext|null,before:Text,after:Text,changes:{from:number;to:number;text:string}[]):IncompleteContext|null{
  if(!previous||previous.doc!==before||changes.length!==1)return null;
  const change=changes[0];
  if(change.from!==previous.pos||change.to!==change.from||!change.text||!/^[$\p{ID_Continue}]+$/u.test(change.text))return null;
  return {...previous,doc:after,pos:previous.pos+change.text.length};
}
