import { boundedCandidates, CODE_LIMITS, CODE_MARKER, validCandidate, validatedHighlights, type CodeCandidate, type CodeFence } from "./document-code-model";
export type OwnedCode = CodeCandidate & { node: HTMLElement };

/** Resolve only generated markers with matching part, unique node and exact text. */
export function collectCodeFences(sections: readonly HTMLElement[], raw: unknown): OwnedCode[] {
  const metadata = Array.isArray(raw) && raw.length <= CODE_LIMITS.blocks ? raw : [];
  const known = new Map<string, CodeFence>(), invalid = new Set<string>();
  for (const value of metadata) {
    if (!validCandidate(value) || !Number.isInteger((value as CodeFence).part)) continue;
    const fence = value as CodeFence;
    if (fence.part < 0 || fence.part >= sections.length) continue;
    if (known.has(fence.id)) invalid.add(fence.id);
    known.set(fence.id, fence);
  }
  const found = new Map<string, OwnedCode>();
  sections.forEach((section, part) => {
    for (const element of section.querySelectorAll<HTMLElement>(`[${CODE_MARKER}]`)) {
      const id = element.getAttribute(CODE_MARKER)!;
      element.removeAttribute(CODE_MARKER);
      const fence = known.get(id);
      if (!fence) continue;
      if (found.has(id)) invalid.add(id);
      if (fence.part !== part || element.tagName !== "CODE" || element.parentElement?.tagName !== "PRE" ||
          element.children.length || element.textContent !== fence.text) { invalid.add(id); continue; }
      found.set(id, { id, language: fence.language, text: fence.text, node: element });
    }
  });
  return [...found.values()].filter(value => !invalid.has(value.id));
}

let activeHighlightWorker = false;
/** At most one optional worker, separate from the two existing Markdown slots. */
async function requestHighlights(candidates: CodeCandidate[], signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted || activeHighlightWorker) return [];
  activeHighlightWorker = true;
  return new Promise(resolve => {
    let worker: Worker | undefined, finished = false, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: unknown = []) => {
      if (finished) return;
      finished = true; clearTimeout(timer); worker?.terminate(); signal?.removeEventListener("abort", abort);
      activeHighlightWorker = false; resolve(value);
    };
    const abort = () => finish();
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(), CODE_LIMITS.timeout);
    try {
      worker = new Worker(new URL("./document-code.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = event => finish(event.data?.highlights);
      worker.onerror = () => finish();
      worker.onmessageerror = () => finish();
      worker.postMessage({ candidates });
    } catch { finish(); }
  });
}

/** Decorate detached sanitized content once; never touch an indexed reader. */
export async function highlightDocumentCode(root: HTMLElement, values: readonly OwnedCode[], signal?: AbortSignal) {
  if (root.isConnected || signal?.aborted) return;
  const byId = new Map(values.map(value => [value.id, value]));
  const candidates = boundedCandidates(values);
  if (!candidates.length) return;
  let nodes = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  while (walker.nextNode()) if (++nodes > CODE_LIMITS.nodes) return;
  // Do not structured-clone DOM nodes. Only the explicitly selected text is sent.
  const request = candidates.map(({ id, language, text }) => ({ id, language, text }));
  const response = await requestHighlights(request, signal);
  if (signal?.aborted || root.isConnected) return;
  const highlights = validatedHighlights(response, request);
  if (!highlights) return;
  for (const block of highlights) {
    const candidate = byId.get(block.id);
    if (!candidate || !root.contains(candidate.node) || candidate.node.children.length ||
        candidate.node.textContent !== candidate.text || !block.ranges.length) continue;
    // One span + text + optional gap per range; deliberately conservative.
    const extra = block.ranges.length * 3 + 1;
    if (nodes + extra > CODE_LIMITS.nodes) continue;
    const fragment = document.createDocumentFragment();
    let from = 0;
    for (const range of block.ranges) {
      if (range.from > from) fragment.append(document.createTextNode(candidate.text.slice(from, range.from)));
      const span = document.createElement("span");
      span.className = "lsp-code-" + range.token; span.textContent = candidate.text.slice(range.from, range.to);
      fragment.append(span); from = range.to;
    }
    if (from < candidate.text.length) fragment.append(document.createTextNode(candidate.text.slice(from)));
    candidate.node.replaceChildren(fragment); nodes += extra;
  }
}
