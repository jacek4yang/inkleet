export type DebugVariable = { name: string; value: string; type?: string; variablesReference: number; namedVariables?: number; indexedVariables?: number; presentationHint?: { lazy?: boolean; attributes?: string[] } };
export type DebugFrame = { id: number; name: string; line: number; column?: number; endLine?: number; endColumn?: number; inkleetSource?: boolean; source?: { name?: string; path?: string; sourceReference?: number } };
export type DebugScope = { name: string; variablesReference: number; expensive?: boolean };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export function debugVariables(value: unknown): DebugVariable[] {
  return list(value).slice(0, 100).flatMap(item => {
    if (!record(item) || typeof item.name !== "string" || typeof item.value !== "string") return [];
    return [{name: item.name.slice(0, 200), value: item.value.slice(0, 4000), type: typeof item.type === "string" ? item.type.slice(0, 512) : undefined,
      variablesReference: integer(item.variablesReference) ? item.variablesReference : 0,
      namedVariables: integer(item.namedVariables) ? item.namedVariables : undefined,
      indexedVariables: integer(item.indexedVariables) ? item.indexedVariables : undefined,
      presentationHint: record(item.presentationHint) ? {lazy: item.presentationHint.lazy === true, attributes: Array.isArray(item.presentationHint.attributes) ? item.presentationHint.attributes.filter((x):x is string=>typeof x==="string"&&["readOnly","virtual"].includes(x)).slice(0,2) : undefined} : undefined}];
  });
}
export function debugFrames(value: unknown): DebugFrame[] {
  const seen = new Set<number>();
  return list(value).slice(0, 64).flatMap(item => {
    if (!record(item) || !integer(item.id) || seen.has(item.id) || typeof item.name !== "string") return [];
    seen.add(item.id);
    const source = record(item.source) ? {name: typeof item.source.name === "string" ? item.source.name.slice(0, 1024) : undefined, sourceReference: integer(item.source.sourceReference) ? item.source.sourceReference : undefined, path: typeof item.source.path === "string" ? item.source.path.slice(0, 4096) : undefined} : undefined;
    return [{id: item.id, name: item.name.slice(0, 200), line: integer(item.line) ? item.line : 0, column:integer(item.column)?item.column:undefined, endLine:integer(item.endLine)?item.endLine:undefined, endColumn:integer(item.endColumn)?item.endColumn:undefined, inkleetSource:typeof item.inkleetSource==="boolean"?item.inkleetSource:undefined, source}];
  });
}
export function debugScopes(value: unknown): DebugScope[] {
  return list(value).slice(0, 20).flatMap(item => record(item) && typeof item.name === "string" && integer(item.variablesReference) && item.variablesReference > 0
    ? [{name: item.name.slice(0, 100), variablesReference: item.variablesReference, expensive: item.expensive === true}] : []);
}
export function debugThreads(value: unknown): {id:number;name:string}[] {
  const seen = new Set<number>();
  return list(value).slice(0, 100).flatMap(item => {
    if (!record(item) || !integer(item.id) || item.id === 0 || seen.has(item.id) || typeof item.name !== "string") return [];
    seen.add(item.id); return [{id:item.id, name:item.name.slice(0,200)}];
  });
}

/** Only the adapter-marked synthetic raw branch is a detail; user fields are never guessed. */
export function isRawDebugVariable(value:DebugVariable){return value.name==="[raw]"&&value.presentationHint?.attributes?.includes("readOnly")===true&&value.presentationHint.attributes.includes("virtual");}
