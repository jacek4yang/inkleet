import { Prec, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
const kinds = new Set(["namespace","type","class","enum","interface","struct","typeParameter","parameter","variable","property","enumMember","event","function","method","macro","keyword","modifier","comment","string","number","regexp","operator","decorator"]);
export type SemanticSpan = { from:number; to:number; kind:string; readonly:boolean; deprecated:boolean };
function boundary(text:string,at:number) {
  return !(at>0&&at<text.length&&text.charCodeAt(at-1)>=0xd800&&text.charCodeAt(at-1)<=0xdbff&&text.charCodeAt(at)>=0xdc00&&text.charCodeAt(at)<=0xdfff);
}
export function decodeSemanticSpans(doc:Text,value:unknown):SemanticSpan[] {
  if(!Array.isArray(value)||value.length>20000)throw Error("Invalid semantic token budget");
  const result:SemanticSpan[]=[];let previous=0;let cachedLine=-1;let cached:ReturnType<Text["line"]>|null=null;
  for(const t of value){
    if(!t||!Number.isInteger(t.line)||!Number.isInteger(t.start)||!Number.isInteger(t.end)||t.line<0||t.line>=doc.lines||t.start<0||t.end<=t.start||typeof t.kind!=="string"||!Array.isArray(t.modifiers))throw Error("Invalid semantic token");
    if(cachedLine!==t.line){cached=doc.line(t.line+1);cachedLine=t.line;}
    const line=cached!;
    if(t.end>line.length||!boundary(line.text,t.start)||!boundary(line.text,t.end))throw Error("Invalid semantic token boundary");
    const from=line.from+t.start,to=line.from+t.end;
    if(from<previous)throw Error("Overlapping semantic tokens");previous=to;
    if(kinds.has(t.kind))result.push({from,to,kind:t.kind,readonly:t.modifiers.includes("readonly"),deprecated:t.modifiers.includes("deprecated")});
  }
  return result;
}
export const setSemanticTokens=StateEffect.define<readonly SemanticSpan[]>();
export const semanticField=StateField.define<DecorationSet>({
  create:()=>Decoration.none,
  update(value,tr){
    if(tr.docChanged)return Decoration.none;
    for(const effect of tr.effects)if(effect.is(setSemanticTokens))value=Decoration.set(effect.value.map(t=>Decoration.mark({class:"cm-semantic cm-semantic-"+t.kind+(t.readonly?" cm-semantic-readonly":"")+(t.deprecated?" cm-semantic-deprecated":"")}).range(t.from,t.to)),true);
    return value;
  },
  provide:field=>Prec.highest(EditorView.decorations.from(field)),
});
export const semanticTheme=EditorView.baseTheme({
  ".cm-semantic-type, .cm-semantic-class, .cm-semantic-struct, .cm-semantic-interface, .cm-semantic-enum, .cm-semantic-typeParameter":{color:"var(--semantic-type, #866447)"},
  ".cm-semantic-function, .cm-semantic-method, .cm-semantic-macro":{color:"var(--semantic-function, #4c728c)"},
  ".cm-semantic-parameter, .cm-semantic-property":{color:"var(--semantic-property, #766044)"},
  ".cm-semantic-namespace":{color:"var(--semantic-namespace, #61725e)"},
  ".cm-semantic-enumMember, .cm-semantic-readonly":{color:"var(--semantic-constant, #96674e)"},
  ".cm-semantic-deprecated":{textDecoration:"line-through"},
});
