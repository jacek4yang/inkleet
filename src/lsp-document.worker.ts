import { marked, Renderer } from "marked";
import { CODE_LIMITS, CODE_MARKER, codeLanguage, type CodeFence } from "./document-code-model";

self.onmessage = (event: MessageEvent<{ parts: { kind: string; text: string }[]; highlight?: boolean }>) => {
  try {
    const parts = event.data.parts;
    if (!Array.isArray(parts) || parts.length > 100 || parts.some(p => !p || typeof p.text !== "string") ||
        parts.reduce((n, p) => n + p.text.length, 0) > 262144) throw Error("document limit");
    let nonce = "";
    if (event.data.highlight === true) {
      // Highlighting is optional even when secure random generation is unavailable.
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const candidate = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, "0")).join("");
          if (parts.every(part => !part.text.includes(candidate))) { nonce = candidate; break; }
        }
      } catch { /* Baseline Markdown does not depend on optional markers. */ }
    }
    const fences: CodeFence[] = [], markers: string[] = [];
    let units = 0;
    const html = parts.map((part, index) => {
      if (part.kind !== "markdown") return null;
      if (!nonce) return marked.parse(part.text, { async: false, gfm: true });
      const renderer = new Renderer();
      renderer.code = function(token) {
        const baseline = Renderer.prototype.code.call(this, token), language = codeLanguage(token.lang);
        // Delegate all escaping and newline behavior to the installed Marked renderer.
        const text = token.text ? token.text.replace(/\n$/, "") + "\n" : "";
        if (!language || token.escaped || !text || text.length > CODE_LIMITS.blockUnits ||
            fences.length >= CODE_LIMITS.blocks || units + text.length > CODE_LIMITS.totalUnits) return baseline;
        const id = "f-" + nonce + "-" + fences.length, marker = ` ${CODE_MARKER}="${id}"`;
        fences.push({ id, part: index, language, text }); markers.push(marker); units += text.length;
        return baseline.replace("<code", "<code" + marker);
      };
      return marked.parse(part.text, { async: false, gfm: true, renderer });
    });
    if (html.reduce((n, value) => n + (value?.length ?? 0), 0) > 262144 && markers.length) {
      // Decorations must never make a formerly valid baseline overflow its limit.
      for (let i = 0; i < html.length; i++) if (html[i] !== null) {
        let value = html[i]!;
        for (const marker of markers) value = value.replace(marker, "");
        html[i] = value;
      }
      fences.length = 0;
    }
    if (html.reduce((n, value) => n + (value?.length ?? 0), 0) > 262144) throw Error("render limit");
    self.postMessage({ html, fences });
  } catch { self.postMessage({ error: true }); }
};
