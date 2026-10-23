import DOMPurify from "dompurify";
/** Detached, allowlisted HTML only: never attach remote nodes or fetch resources. */
export function statementText(html:string):string{
 const root=DOMPurify.sanitize(html,{RETURN_DOM_FRAGMENT:true,
  ALLOWED_TAGS:["p","div","span","strong","b","em","i","u","s","br","hr","pre","code","ul","ol","li","h1","h2","h3","h4","blockquote","table","thead","tbody","tr","td","th","sup","sub"],
  ALLOWED_ATTR:["start","value","reversed"],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
 const walk=(node:Node,pre=false,depth=0):string=>{
  if(node.nodeType===Node.TEXT_NODE)return pre?node.textContent??"":(node.textContent??"").replace(/\s+/g," ");
  if(node.nodeType!==Node.ELEMENT_NODE&&node.nodeType!==Node.DOCUMENT_FRAGMENT_NODE)return "";
  const tag=node instanceof Element?node.tagName:"";
  const body=Array.from(node.childNodes).map(child=>walk(child,pre||tag==="PRE",depth+(tag==="OL"||tag==="UL"?1:0))).join("");
  if(tag==="BR")return "\n";
  if(tag==="HR")return "\n";
  if(tag==="SUP")return "^("+body+")";
  if(tag==="SUB")return "_("+body+")";
  if(tag==="LI"){
   const element=node as Element,parent=element.parentElement;
   let marker="- ";
   if(parent?.tagName==="OL"){
    const siblings=Array.from(parent.children).filter(child=>child.tagName==="LI"),step=parent.hasAttribute("reversed")?-1:1;
    const integer=(value:string|null,fallback:number)=>value!==null&&/^-?\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):fallback;
    let number=integer(parent.getAttribute("start"),step===-1?siblings.length:1);
    for(const sibling of siblings){number=integer(sibling.getAttribute("value"),number);if(sibling===element)break;number+=step;}
    marker=number+". ";
   }
   return "\n"+"  ".repeat(Math.max(0,depth-1))+marker+body.trim()+"\n";
  }
  if(tag==="TD"||tag==="TH")return body.trim()+"\t";
  if(["P","DIV","PRE","UL","OL","H1","H2","H3","H4","BLOCKQUOTE","TABLE","TR"].includes(tag))return "\n"+body+"\n";
  return body;
 };
 return walk(root).trim();
}
