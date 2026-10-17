import { boundedCandidates, CODE_LIMITS, CODE_TOKENS, type CodeCandidate, type CodeHighlight, type CodeLanguage, type CodeRange } from "./document-code-model";

// No parser or highlighter enters the Markdown worker or main-thread bundle.
async function parserFor(language: CodeLanguage) {
  switch (language) {
    case "rust": return (await import("@codemirror/lang-rust")).rustLanguage.parser;
    case "python": return (await import("@codemirror/lang-python")).pythonLanguage.parser;
    case "go": return (await import("@codemirror/lang-go")).goLanguage.parser;
    case "cpp": return (await import("@codemirror/lang-cpp")).cppLanguage.parser;
    case "java": return (await import("@codemirror/lang-java")).javaLanguage.parser;
  }
}
let started = false;
self.onmessage = async (event: MessageEvent<{ candidates?: CodeCandidate[] }>) => {
  if (started) return;
  started = true;
  try {
    const raw = event.data?.candidates;
    if (!Array.isArray(raw) || raw.length > CODE_LIMITS.blocks) throw Error("code input limit");
    const candidates = boundedCandidates(raw);
    if (candidates.length !== raw.length) throw Error("invalid code input");
    // Fetch only requested grammars, in parallel with the small highlighting API.
    const parsers = new Map(candidates.map(candidate => [candidate.language, parserFor(candidate.language).catch(() => null)]));
    const { highlightTree, tagHighlighter, tags } = await import("@lezer/highlight");
    const highlighter = tagHighlighter([
      { tag: [tags.keyword, tags.bool, tags.null], class: "keyword" },
      { tag: [tags.string, tags.regexp, tags.escape], class: "string" },
      { tag: tags.number, class: "number" },
      { tag: tags.comment, class: "comment" },
      { tag: [tags.typeName, tags.className], class: "type" },
      { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: "function" },
      { tag: tags.meta, class: "meta" },
    ]);
    const results: CodeHighlight[] = [];
    let total = 0;
    for (const candidate of candidates) {
      if (total === CODE_LIMITS.ranges) break;
      try {
        const parser = await parsers.get(candidate.language), ranges: CodeRange[] = [];
        if (!parser) continue;
        let overflow = false;
        highlightTree(parser.parse(candidate.text), highlighter, (from, to, classes) => {
          // A tree may expose multiple tags. Use a single fixed palette token.
          const token = classes.split(" ").find(value => (CODE_TOKENS as readonly string[]).includes(value));
          if (!token || overflow) return;
          if (total + ranges.length >= CODE_LIMITS.ranges) { overflow = true; return; }
          ranges.push({ from, to, token });
        });
        if (!overflow) { total += ranges.length; results.push({ id: candidate.id, ranges }); }
      } catch { /* One unsupported parser result must not discard other code. */ }
    }
    self.postMessage({ highlights: results });
  } catch { self.postMessage({ highlights: [] }); }
};
