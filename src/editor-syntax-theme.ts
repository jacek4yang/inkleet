import {HighlightStyle,syntaxHighlighting,defaultHighlightStyle} from "@codemirror/language";
const tokens:Record<string,string>={"#708":"keyword","#219":"atom","#164":"number","#a11":"string","#940":"comment","#00f":"function","#30a":"atom","#085":"type","#170":"type","#f50":"string","#a50":"string","#f00":"invalid","#555":"comment"};
// Preserve every default rule, including Markdown font styles and decorations.
export const editorSyntaxTheme=syntaxHighlighting(HighlightStyle.define(defaultHighlightStyle.specs.map(spec=>{
 const color=typeof spec.color==="string"?spec.color:undefined,token=color&&tokens[color.toLowerCase()];
 return token?{...spec,color:"var(--syntax-"+token+","+color+")"}:spec;
})));
