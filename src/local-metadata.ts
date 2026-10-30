/** Runtime metadata is enriched only from the official Rust template, never from a draft. */
export function localMetadata(metadata: string, language: string, officialTemplate?: string): string {
  if (language !== "rust" || !officialTemplate) return metadata;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(metadata); } catch { return metadata; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return metadata;
  try {
    if(parsed.systemdesign||parsed.classname){
      const methods=rustDesignSignatures(officialTemplate,parsed);
      return JSON.stringify({...parsed,inkleetRustDesignMethods:methods});
    }
    const signature = rustSignature(officialTemplate);
    if (!Array.isArray(parsed.params) || signature.modes.length !== parsed.params.length) throw new Error("参数数量不匹配");
    return JSON.stringify({ ...parsed, inkleetRustName: signature.name, inkleetRustParameterModes: signature.modes });
  } catch {
    return JSON.stringify({ ...parsed, inkleetRustSignatureError: "官方 Rust 模板的函数签名暂无法解析，请使用力扣运行" });
  }
}
function cleanTemplate(template:string):string{
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
  return clean;
}
export function rustSignature(template: string): { name: string; modes: ("move" | "ref" | "mut")[] } {
  const clean=cleanTemplate(template);let i=0;
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

/** Design signatures come only from the official template, never the editable draft. */
export function rustDesignSignatures(template:string,metadata:Record<string,unknown>):Record<string,{name:string;modes:("move"|"ref"|"mut")[]}>{
 const classname=metadata.classname;
 if(typeof classname!=="string"||! /^[A-Za-z_][A-Za-z_0-9]*$/.test(classname)||!Array.isArray(metadata.methods))throw Error("设计类元数据无效");
 const clean=cleanTemplate(template),impl=new RegExp("\\bimpl\\s+"+classname+"\\s*\\{").exec(clean);
 if(!impl)throw Error("缺少设计类 impl");
 let at=impl.index+impl[0].length;
 const signatures=new Map<string,{name:string;modes:("move"|"ref"|"mut")[];receiver:boolean}>();
 while(at<clean.length){
  const space=/^\s*/.exec(clean.slice(at))![0];at+=space.length;if(clean[at]==="}")break;
  const head=/^(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?fn\s+(?:r#)?([A-Za-z_][A-Za-z_0-9]*)\s*\(/.exec(clean.slice(at));
  if(!head)throw Error("不支持的设计类方法签名");at+=head[0].length;
  let end=at,depth=1;for(;end<clean.length&&depth;end++){if(clean[end]==="(")depth++;else if(clean[end]===")")depth--;}
  if(depth)throw Error("设计类参数不完整");
  let raw=clean.slice(at,end-1),receiver=false;
  const own=/^\s*&\s*(?:'[A-Za-z_][A-Za-z_0-9]*\s*)?(?:mut\s+)?self\s*(?:,|$)/.exec(raw);
  if(own){receiver=true;raw=raw.slice(own[0].length);}
  // Reuse the bounded ordinary parameter parser after removing the receiver.
  const signature=rustSignature("impl Solution { pub fn "+head[1]+"("+raw+") {} }");
  if(signatures.has(head[1]))throw Error("设计类方法名重复");signatures.set(head[1],{...signature,receiver});
  at=end;while(at<clean.length&&clean[at]!=="{"&&clean[at]!==";")at++;
  if(clean[at]!=="{")throw Error("设计类方法体缺失");
  depth=1;at++;while(at<clean.length&&depth){if(clean[at]==="{")depth++;else if(clean[at]==="}")depth--;at++;}
  if(depth)throw Error("设计类方法体不完整");
 }
 const constructor=metadata.constructor as {params?:unknown[]}|undefined;
 const expected=[{name:classname,params:constructor?.params},...metadata.methods] as {name:unknown;params:unknown}[];
 const out:Record<string,{name:string;modes:("move"|"ref"|"mut")[]}>={};
 for(let i=0;i<expected.length;i++){
  const entry=expected[i];if(typeof entry.name!=="string"||!Array.isArray(entry.params))throw Error("设计类参数元数据无效");
  const snake=entry.name.replace(/([a-z0-9])([A-Z])/g,"$1_$2").replace(/([A-Z])([A-Z][a-z])/g,"$1_$2").toLowerCase();
  const signature=signatures.get(i===0?"new":snake);
  if(!signature||signature.modes.length!==entry.params.length||signature.receiver!==(i>0))throw Error("设计类官方签名不匹配");
  out[entry.name]={name:signature.name,modes:signature.modes};
 }
 return out;
}
