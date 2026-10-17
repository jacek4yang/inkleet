export const CODE_LIMITS = { blocks: 32, blockUnits: 8192, totalUnits: 32768, ranges: 1024, nodes: 28000, timeout: 400 } as const;
export const CODE_MARKER = "data-inkleet-code";
export type CodeLanguage = "rust" | "python" | "go" | "cpp" | "java";
export type CodeCandidate = { id: string; language: CodeLanguage; text: string };
export type CodeFence = CodeCandidate & { part: number };
export type CodeRange = { from: number; to: number; token: string };
export type CodeHighlight = { id: string; ranges: CodeRange[] };
export const CODE_TOKENS = ["keyword", "string", "number", "comment", "type", "function", "meta"] as const;
export function codeLanguage(value: unknown): CodeLanguage | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const name = value.trim().split(/\s+/, 1)[0].toLowerCase();
  switch (name) {
    case "rust": case "rs": return "rust";
    case "python": case "python3": case "py": case "py3": return "python";
    case "go": case "golang": return "go";
    case "c": case "cpp": case "c++": case "cc": case "cxx": return "cpp";
    case "java": return "java";
    default: return null;
  }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function validCandidate(value: unknown): value is CodeCandidate {
  if (!object(value)) return false;
  return typeof value.id === "string" && /^[a-z0-9-]{1,100}$/.test(value.id) &&
    typeof value.language === "string" && codeLanguage(value.language) === value.language &&
    typeof value.text === "string" && value.text.length > 0 && value.text.length <= CODE_LIMITS.blockUnits;
}
export function boundedCandidates(values: readonly CodeCandidate[]): CodeCandidate[] {
  const result: CodeCandidate[] = [], ids = new Set<string>();
  let units = 0;
  for (const value of values) {
    if (result.length === CODE_LIMITS.blocks) break;
    if (!validCandidate(value) || ids.has(value.id) || units + value.text.length > CODE_LIMITS.totalUnits) continue;
    result.push(value); ids.add(value.id); units += value.text.length;
  }
  return result;
}
function boundary(text: string, at: number) {
  return !(at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]));
}
/** Reject the complete optional response on malformed or over-budget output. */
export function validatedHighlights(raw: unknown, candidates: readonly CodeCandidate[]): CodeHighlight[] | null {
  if (!Array.isArray(raw) || raw.length > CODE_LIMITS.blocks) return null;
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate])), seen = new Set<string>();
  const result: CodeHighlight[] = [];
  let count = 0;
  for (const block of raw) {
    if (!object(block) || typeof block.id !== "string" || seen.has(block.id) || !Array.isArray(block.ranges)) return null;
    const candidate = byId.get(block.id);
    if (!candidate || (count += block.ranges.length) > CODE_LIMITS.ranges) return null;
    let end = 0;
    const ranges: CodeRange[] = [];
    for (const range of block.ranges) {
      if (!object(range) || typeof range.from !== "number" || typeof range.to !== "number" ||
          !Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < end || range.to <= range.from ||
          range.to > candidate.text.length || !boundary(candidate.text, range.from) || !boundary(candidate.text, range.to) ||
          typeof range.token !== "string" || !(CODE_TOKENS as readonly string[]).includes(range.token)) return null;
      ranges.push({ from: range.from, to: range.to, token: range.token }); end = range.to;
    }
    seen.add(block.id); result.push({ id: block.id, ranges });
  }
  return result;
}
