import DOMPurify from "dompurify";
import { documentReaderSearch } from "./lsp-document-search";
import { documentationModel } from "./lsp-document-model";
import { CODE_MARKER, CODE_LIMITS, codeLanguage, validCandidate, type CodeFence } from "./document-code-model";
import { collectCodeFences, highlightDocumentCode, type OwnedCode } from "./document-code-highlight";

let activeWorkers = 0;
type Rendered = { html: (string | null)[]; fences: CodeFence[] };
const cache = new Map<string, Rendered>();
let cacheBytes = 0;
const resultSize = (value: Rendered) => value.html.reduce((n, html) => n + (html?.length ?? 0), 0) + JSON.stringify(value.fences).length;
const tags = ["p","br","hr","strong","em","del","blockquote","ul","ol","li","pre","code","table","thead","tbody","tr","th","td","h1","h2","h3","h4","h5","h6","kbd","sub","sup"];
type DocumentOptions = { expanded?: boolean; title?: string; summaryFirst?: boolean; beforeOpen?: () => void };

function fenceMetadata(raw: unknown, partCount: number): CodeFence[] {
  if (!Array.isArray(raw) || raw.length > CODE_LIMITS.blocks) return [];
  const result: CodeFence[] = [];
  let units = 0;
  for (const value of raw) {
    if (!validCandidate(value)) return [];
    const part = (value as CodeFence).part;
    if (!Number.isInteger(part) || part < 0 || part >= partCount || !/^f-[a-f0-9]{32}-\d+$/.test(value.id) ||
        (units += value.text.length) > CODE_LIMITS.totalUnits) return [];
    result.push({ id: value.id, language: value.language, text: value.text, part });
  }
  return result;
}

export async function renderDocumentation(value: unknown, legacy = false, signal?: AbortSignal, options: DocumentOptions = {}): Promise<HTMLElement | null> {
  const { parts, truncated } = documentationModel(value, legacy, options.expanded);
  if ((!parts.length && !truncated) || signal?.aborted) return null;
  const key = (options.expanded ? "reader:" : "preview:") + JSON.stringify(parts);
  let rendered = cache.get(key);
  if (rendered) { cache.delete(key); cache.set(key, rendered); }
  if (!rendered && parts.some(part => part.kind === "markdown") && activeWorkers < 2) {
    rendered = await new Promise<Rendered | undefined>(resolve => {
      let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined, finished = false;
      const finish = (result?: Rendered) => {
        if (finished) return;
        finished = true; clearTimeout(timer); worker?.terminate(); signal?.removeEventListener("abort", abort);
        activeWorkers--; resolve(result);
      };
      const abort = () => finish();
      activeWorkers++;
      try {
        worker = new Worker(new URL("./lsp-document.worker.ts", import.meta.url), { type: "module" });
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => finish(), 600);
        worker.onmessage = event => {
          const raw = event.data?.html;
          if (!Array.isArray(raw) || raw.length !== parts.length || raw.some(html => html !== null && typeof html !== "string") ||
              raw.reduce((n, html) => n + (html?.length ?? 0), 0) > 262144) { finish(); return; }
          try {
            const html = raw.map(html => html === null ? null : DOMPurify.sanitize(html, {
              ALLOWED_TAGS: tags,
              ALLOWED_ATTR: ["start", "colspan", "rowspan", CODE_MARKER],
              ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
            }));
            finish({ html, fences: fenceMetadata(event.data?.fences, parts.length) });
          } catch { finish(); }
        };
        worker.onerror = () => finish();
        worker.onmessageerror = () => finish();
        worker.postMessage({ parts, highlight: true });
      } catch { finish(); }
    });
    if (rendered && !signal?.aborted) {
      const size = key.length + resultSize(rendered);
      if (size <= 131072 && !cache.has(key)) {
        while (cache.size >= 16 || cacheBytes + size > 262144) {
          const first = cache.keys().next().value;
          if (first === undefined) break;
          cacheBytes -= first.length + resultSize(cache.get(first)!); cache.delete(first);
        }
        cache.set(key, rendered); cacheBytes += size;
      }
    }
  }
  if (signal?.aborted) return null;
  const dom = document.createElement("div"), sections: HTMLElement[] = [], codeParts: OwnedCode[] = [];
  dom.className = "lsp-documentation";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i], section = document.createElement("div");
    section.className = "lsp-document-section";
    if (part.kind === "markdown" && rendered?.html[i] != null) section.innerHTML = rendered.html[i]!;
    else if (part.kind === "code") {
      const pre = document.createElement("pre"), code = document.createElement("code");
      code.textContent = part.text; pre.append(code); section.append(pre);
      const language = codeLanguage(part.language);
      if (language) codeParts.push({ id: "legacy-" + i, language, text: part.text, node: code });
    } else { section.classList.add("lsp-document-plain"); section.textContent = part.text; }
    if (i === 0 && options.summaryFirst) section.classList.add("lsp-completion-summary");
    sections.push(section); dom.append(section);
  }
  if (truncated) {
    const notice = document.createElement("div"); notice.className = "lsp-document-limit"; notice.setAttribute("role", "note");
    notice.textContent = options.expanded ? "文档超出显示上限，当前内容不完整" : "预览仅显示部分内容"; dom.append(notice);
  }
  {
    const fences = collectCodeFences(sections, rendered?.fences);
    try { await highlightDocumentCode(dom, [...fences, ...codeParts], signal); }
    catch { /* Optional color must not discard readable documentation. */ }
    if (signal?.aborted) return null;
  }
  if (!options.expanded) {
    const expand = document.createElement("button"); expand.type = "button"; expand.className = "lsp-document-expand";
    expand.setAttribute("aria-label", "展开文档"); expand.title = "展开文档";
    expand.append(expandIcon()); expand.addEventListener("mousedown", event => event.preventDefault());
    expand.addEventListener("click", () => { options.beforeOpen?.(); void openDocumentationReader(value, legacy, signal, options); });
    dom.prepend(expand);
  }
  return dom;
}
let closeReader:(()=>void)|undefined;
function expandIcon(pathData="M10 2h4v4M14 2 9 7M6 14H2v-4M2 14l5-5"){
 const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 16 16");svg.setAttribute("width","16");svg.setAttribute("height","16");svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");svg.setAttribute("stroke-width","1.2");svg.setAttribute("aria-hidden","true");
 const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",pathData);svg.append(path);return svg;
}
export async function openDocumentationReader(value:unknown,legacy:boolean,owner:AbortSignal|undefined,options:DocumentOptions){
 if(owner?.aborted)return;closeReader?.();
 const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
 const dialog=document.createElement("dialog");dialog.className="lsp-document-reader";dialog.setAttribute("aria-label","文档阅读");
 const header=document.createElement("header"),title=document.createElement("h2"),close=document.createElement("button"),body=document.createElement("div"),lifetime=new AbortController();
 title.textContent=options.title??"文档";close.type="button";close.className="lsp-reader-close";close.append(expandIcon("M4 4l8 8M12 4l-8 8"));close.setAttribute("aria-label","关闭文档");
 body.className="lsp-reader-body";body.tabIndex=0;body.setAttribute("aria-label","文档正文");body.setAttribute("aria-busy","true");body.textContent="正在载入文档";
 header.append(title,close);dialog.append(header,body);
 const search=documentReaderSearch(dialog,body,header);
 let disposed=false;
 const ownerAbort=()=>dispose(false);
 const dispose=(restoreFocus=true)=>{if(disposed)return;const ownsFocus=dialog.contains(document.activeElement);disposed=true;search.destroy();lifetime.abort();owner?.removeEventListener("abort",ownerAbort);if(dialog.open)dialog.close();dialog.remove();if(closeReader===dispose)closeReader=undefined;if(restoreFocus&&ownsFocus&&previous?.isConnected)previous.focus({preventScroll:true});};
 closeReader=dispose;close.addEventListener("click",()=>dispose());dialog.addEventListener("cancel",event=>{event.preventDefault();if(!search.cancel())dispose();});owner?.addEventListener("abort",ownerAbort,{once:true});
 document.body.append(dialog);
 try{
  dialog.showModal();body.focus();
  const content=await renderDocumentation(value,legacy,lifetime.signal,{...options,expanded:true});
  if(disposed)return;
  body.replaceChildren();body.setAttribute("aria-busy","false");
  if(content)body.append(content);else body.textContent="无文档内容";
  search.refresh();
 }catch{dispose();}
}


