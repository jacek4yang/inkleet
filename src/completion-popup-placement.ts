export type PopupRect={left:number;right:number;top:number;bottom:number};
const clamp=(n:number,lo:number,hi:number)=>Math.min(Math.max(n,lo),Math.max(lo,hi));
export function placeCompletionInfo(list:PopupRect,option:PopupRect,space:PopupRect,rtl=false,scaleX=1,scaleY=1){
 const gap=8,left=space.left+gap,right=space.right-gap,top=space.top+gap,bottom=space.bottom-gap;
 if(![...Object.values(list),...Object.values(option),...Object.values(space),scaleX,scaleY].every(Number.isFinite)||scaleX<=0||scaleY<=0||right<=left||bottom<=top)return null;
 const preferredWidth=360*scaleX,preferredHeight=280*scaleY;
 const rooms={left:Math.max(0,list.left-gap-left),right:Math.max(0,right-list.right-gap)};
 const order:("left"|"right")[]=rtl?["left","right"]:["right","left"];
 const side=order.find(s=>rooms[s]>=preferredWidth)??order.find(s=>rooms[s]>=220*scaleX);
 if(side){const width=Math.min(preferredWidth,rooms[side]),height=Math.min(preferredHeight,bottom-top),y=clamp(option.top,top,bottom-height);
 return {mode:side,x:side==="left"?list.left-gap-width:list.right+gap,edge:y,anchor:"top" as const,width,maxHeight:Math.min(preferredHeight,bottom-y)};}
 const below=Math.max(0,bottom-list.bottom-gap),above=Math.max(0,list.top-gap-top);
 const useBelow=below>=Math.min(preferredHeight,96*scaleY)||below>=above,available=useBelow?below:above;
 if(available<48*scaleY)return null;
 const width=Math.min(preferredWidth,right-left);
 return {mode:useBelow?"below":"above",x:clamp(rtl?list.right-width:list.left,left,right-width),edge:useBelow?list.bottom+gap:list.top-gap,anchor:useBelow?"top" as const:"bottom" as const,width,maxHeight:Math.min(preferredHeight,available)};
}
