/** Runtime metadata is enriched only from the official Rust template, never from a draft. */
export function localMetadata(metadata: string, language: string, officialTemplate?: string): string {
  if (language !== "rust" || !officialTemplate) return metadata;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(metadata); } catch { return metadata; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return metadata;
  try {
    const signature = rustSignature(officialTemplate);
    if (!Array.isArray(parsed.params) || signature.modes.length !== parsed.params.length) throw new Error("参数数量不匹配");
    return JSON.stringify({ ...parsed, inkleetRustName: signature.name, inkleetRustParameterModes: signature.modes });
  } catch {
    return JSON.stringify({ ...parsed, inkleetRustSignatureError: "官方 Rust 模板的函数签名暂无法解析，请使用力扣运行" });
  }
}
export function rustSignature(template: string): { name: string; modes: ("move" | "ref" | "mut")[] } {
  if (template.length > 65536) throw new Error("模板过长");
  // Preserve punctuation outside comments. Nested block comments are legal Rust.
  let clean = "", i = 0;
  while (i < template.length) {
    if (template.startsWith("//", i)) { while (i < template.length && template[i] !== "\n") i++; clean += " "; }
    else if (template.startsWith("/*", i)) {
      let depth = 1; i += 2;
      while (i < template.length && depth) {
        if (template.startsWith("/*", i)) { depth++; i += 2; }
        else if (template.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error("注释不完整");
      clean += " ";
    } else if (template[i] === '"') {
      clean += '""'; i++;
      while (i < template.length) { if (template[i] === "\\") i += 2; else if (template[i++] === '"') break; }
    } else clean += template[i++];
  }
  const impl = /\bimpl\s+Solution\s*\{/.exec(clean);
  if (!impl) throw new Error("缺少 Solution");
  const head = /^\s*(?:#\[[^\]]*\]\s*)*pub\s+fn\s+(?:r#)?([A-Za-z_][A-Za-z_0-9]*)\s*\(/.exec(clean.slice(impl.index + impl[0].length));
  if (!head) throw new Error("不支持此函数签名");
  i = impl.index + impl[0].length + head[0].length;
  let depth = 1, end = i;
  for (; end < clean.length && depth; end++) { if (clean[end] === "(") depth++; if (clean[end] === ")") depth--; }
  if (depth) throw new Error("参数不完整");
  const raw = clean.slice(i, end - 1), parameters: string[] = [];
  let start = 0, nested = 0;
  for (let k = 0; k < raw.length; k++) {
    if ("<([".includes(raw[k])) nested++;
    if (">)]".includes(raw[k])) nested--;
    if (nested < 0) throw new Error("参数类型不完整");
    if (raw[k] === "," && nested === 0) { parameters.push(raw.slice(start, k)); start = k + 1; }
  }
  if (nested) throw new Error("参数类型不完整");
  if (raw.slice(start).trim()) parameters.push(raw.slice(start));
  const modes = parameters.map(parameter => {
    const match = /^\s*(?:mut\s+)?(?:r#)?[A-Za-z_][A-Za-z_0-9]*\s*:\s*(.*?)\s*$/.exec(parameter);
    if (!match) throw new Error("不支持此参数");
    const ty = match[1];
    if (!ty) throw new Error("参数类型缺失");
    if (/^&\s*(?:'[A-Za-z_][A-Za-z_0-9]*\s*)?mut\b/.test(ty)) return "mut" as const;
    if (ty.startsWith("&")) return "ref" as const;
    return "move" as const;
  });
  return { name: head[1], modes };
}
