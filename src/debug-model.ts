export type DebugVariable = { name: string; value: string; type?: string; variablesReference: number; namedVariables?: number; indexedVariables?: number; presentationHint?: { lazy?: boolean } };
export type DebugFrame = { id: number; name: string; line: number; source?: { name?: string; path?: string } };
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
      presentationHint: record(item.presentationHint) ? {lazy: item.presentationHint.lazy === true} : undefined}];
  });
}
export function debugFrames(value: unknown): DebugFrame[] {
  const seen = new Set<number>();
  return list(value).slice(0, 64).flatMap(item => {
    if (!record(item) || !integer(item.id) || seen.has(item.id) || typeof item.name !== "string") return [];
    seen.add(item.id);
    const source = record(item.source) ? {name: typeof item.source.name === "string" ? item.source.name.slice(0, 1024) : undefined, path: typeof item.source.path === "string" ? item.source.path.slice(0, 4096) : undefined} : undefined;
    return [{id: item.id, name: item.name.slice(0, 200), line: integer(item.line) ? item.line : 0, source}];
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
