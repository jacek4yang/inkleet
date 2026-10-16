import {Direction,type EditorView} from "@codemirror/view";
import {autocompletion} from "@codemirror/autocomplete";
import {placeCompletionInfo} from "./completion-popup-placement";
let nextId=0;
export function completionPopup(){
 const owner="inkleet-completion-"+(++nextId);
 const positionInfo:NonNullable<NonNullable<Parameters<typeof autocompletion>[0]>["positionInfo"]>=(view,list,option,_info,space)=>{
  const tooltip=view.dom.ownerDocument.querySelector<HTMLElement>("."+owner);
  const hidden={style:"visibility:hidden;pointer-events:none;",class:"inkleet-completion-info"};
  if(!tooltip||!tooltip.offsetWidth||!tooltip.offsetHeight)return hidden;
  const sx=(list.right-list.left)/tooltip.offsetWidth,sy=(list.bottom-list.top)/tooltip.offsetHeight;
  const p=placeCompletionInfo(list,option,space,view.textDirection===Direction.RTL,sx,sy);if(!p)return hidden;
  const x=(p.x-list.left)/sx-tooltip.clientLeft,y=(p.edge-list.top)/sy-tooltip.clientTop;
  const vertical=p.anchor==="top"?"top:"+y+"px;bottom:auto;":"top:auto;bottom:"+(tooltip.clientHeight-y)+"px;";
  return {style:"position:absolute;box-sizing:border-box;margin:0;min-width:0;min-height:0;left:"+x+"px;right:auto;"+vertical+"width:"+p.width/sx+"px;max-width:"+p.width/sx+"px;max-height:"+p.maxHeight/sy+"px;overflow:auto;visibility:visible;",class:"inkleet-completion-info inkleet-completion-info-"+p.mode};
 };
 return {tooltipClass:()=>"inkleet-completion "+owner,positionInfo,scrollDocs(view:EditorView,direction:1|-1){
  const info=view.dom.ownerDocument.querySelector<HTMLElement>("."+owner+" .cm-completionInfo");
  if(!view.hasFocus||!info||getComputedStyle(info).visibility==="hidden"||info.scrollHeight<=info.clientHeight)return false;
  info.scrollTop+=direction*Math.max(24,info.clientHeight*.8);return true;
 }};
}
