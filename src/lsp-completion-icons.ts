import type {Completion} from "@codemirror/autocomplete";
// Independently drawn 16px symbols. No upstream icon/font dependency.
const shapes:Record<string,string>={
 function:"M6 3H5a2 2 0 0 0-2 2v1L1.5 8 3 10v1a2 2 0 0 0 2 2h1M10 3h1a2 2 0 0 1 2 2v1L14.5 8 13 10v1a2 2 0 0 1-2 2h-1",
 variable:"m2 4 4 8 4-8M11 11h3",
 class:"m8 1.5 6 3.3v6.4l-6 3.3-6-3.3V4.8Zm-6 3.3 6 3.4 6-3.4M8 8.2v6.3",
 property:"M3 3h10v10H3ZM6 6h4M6 9h3",
 keyword:"m5 4-4 4 4 4m6-8 4 4-4 4M9 2 7 14",
 snippet:"M3 1.5h7l3 3V14H3Zm7 0v3h3M5 7l2 2-2 2M9 11h2",
 file:"M3 1.5h7l3 3V14H3Zm7 0v3h3",
 text:"M2 3h12M8 3v10M5 13h6"
};
export function completionIcon(completion:Completion):HTMLElement{
 const type=completion.type?.split(" ")[0]??"text";
 const shape=["method","constructor"].includes(type)?"function":["interface","struct","enum","namespace","type"].includes(type)?"class":["constant","value"].includes(type)?"variable":type;
 const holder=document.createElement("span");holder.className="lsp-completion-icon";holder.setAttribute("aria-hidden","true");
 const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 16 16");svg.setAttribute("width","16");svg.setAttribute("height","16");svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");svg.setAttribute("stroke-width","1.2");svg.setAttribute("stroke-linejoin","round");svg.setAttribute("stroke-linecap","round");
 const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",shapes[shape]??shapes.text);svg.append(path);holder.append(svg);return holder;
}
