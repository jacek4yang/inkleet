import type { DebugVariable } from "./debug-model";

export const VARIABLE_PAGE_SIZE = 100;
export const VARIABLE_NODE_LIMIT = 1000;
export type VariablePage = { items: DebugVariable[]; received: number; limited: boolean };
export type VariableReader = (reference: number, start?: number, count?: number) => Promise<VariablePage>;
export type RustVisualKind = "map" | "set" | "sequence" | "string" | "variant" | "pointer" | "generic";
/** Identify only known standard-library types; never infer a user-defined memory layout. */
export function rustVisualKind(type?: string): RustVisualKind {
  const base = type?.split("<", 1)[0].trim() ?? "";
  if (/^(?:std::collections::(?:hash::map|hash_map)|alloc::collections::btree::map|std::collections::btree_map)::(?:HashMap|BTreeMap)$/.test(base)) return "map";
  if (/^(?:std::collections::(?:hash::set|hash_set)|alloc::collections::btree::set|std::collections::btree_set)::(?:HashSet|BTreeSet)$/.test(base)) return "set";
  if (/^(?:alloc::vec::Vec|alloc::collections::vec_deque::VecDeque|alloc::collections::binary_heap::BinaryHeap|alloc::collections::linked_list::LinkedList)$/.test(base) || /^&?\[/.test(type ?? "")) return "sequence";
  if (["alloc::string::String", "&str", "str", "char"].includes(base)) return "string";
  if (/^core::(?:option::Option|result::Result)$/.test(base)) return "variant";
  if (/^alloc::(?:boxed::Box|rc::(?:Rc|Weak)|sync::(?:Arc|Weak))$/.test(base)) return "pointer";
  return "generic";
}
export function knownVariableCount(variable: DebugVariable): number | undefined {
  if (variable.namedVariables === undefined || variable.indexedVariables === undefined) return undefined;
  const count = (variable.namedVariables ?? 0) + (variable.indexedVariables ?? 0);
  return Number.isSafeInteger(count) ? count : undefined;
}
export function pageRepeats(previous: DebugVariable[], page: DebugVariable[]): boolean {
  if (!page.length || previous.length < page.length) return false;
  // Some adapters ignore DAP start/count. Stop, rather than presenting repeated data as new.
  const same = (a: DebugVariable, b: DebugVariable) => a.name === b.name && a.value === b.value && a.type === b.type && a.variablesReference === b.variablesReference;
  for (let start = 0; start <= previous.length - page.length; start++) {
    if (page.every((value, index) => same(value, previous[start + index]))) return true;
  }
  return false;
}

export const MAP_PAGE_SIZE = 20;
/** Strip only namespace qualifiers for display; the complete adapter type stays in details. */
export function compactDebugType(type?: string): string {
  return (type ?? "").replace(/\b(?:[A-Za-z_][\w]*::)+(?=[A-Za-z_])/g, "");
}
export type MapPair = { key: DebugVariable; value: DebugVariable };
/** Only used below an identified standard-library map. Never parse a value summary. */
export function mapEntryPair(items: DebugVariable[]): MapPair | null {
  const logical = items.filter(item => !(item.name === "[raw]" && item.presentationHint?.attributes?.includes("readOnly") && item.presentationHint.attributes.includes("virtual")));
  if (logical.length !== 2) return null;
  for (const [keyName, valueName] of [["0", "1"], [".0", ".1"], ["key", "value"]]) {
    const key = logical.find(item => item.name === keyName), value = logical.find(item => item.name === valueName);
    if (key && value) return { key, value };
  }
  return null;
}
/** Counts and zero-size summaries are adapter evidence; `{...}` never proves emptiness. */
export function emptyDebugCollection(variable: DebugVariable): boolean {
  return knownVariableCount(variable) === 0 || /^(?:size|len|length)\s*=\s*0$/.test(variable.value.trim());
}
/** Shared by map pages, expansions and pauses so canceled in-flight reads still count. */
export class MapReadQueue {
  private active = 0;
  private pending: Array<() => void> = [];
  private readonly limit: number;
  constructor(limit = 4) { this.limit = limit; }
  run(work: () => Promise<VariablePage>, current: () => boolean): Promise<VariablePage> {
    return new Promise((resolve, reject) => {
      if (this.pending.length >= 128) { reject(new Error("变量读取队列已满，请稍后重试")); return; }
      this.pending.push(() => {
        if (!current()) { reject(new Error("变量读取已取消")); return; }
        this.active++;
        void Promise.resolve().then(() => { if (!current()) throw new Error("变量读取已取消"); return work(); }).then(resolve, reject).finally(() => { this.active--; this.drain(); });
      });
      this.drain();
    });
  }
  private drain() { while (this.active < this.limit && this.pending.length) this.pending.shift()!(); }
}
const mapReads = new MapReadQueue();
/** A bounded queue owned by the currently visible map page. No eager recursive reads. */
export async function readMapPairs(
  entries: DebugVariable[], read: VariableReader, current: () => boolean,
  receive: (index: number, pair: MapPair | null, error?: string) => void,
): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (current()) {
      const index = cursor++;
      if (index >= entries.length) return;
      const entry = entries[index];
      if (!entry.variablesReference) { receive(index, null); continue; }
      try {
        // Two tuple fields plus the adapter's optional synthetic raw branch.
        const page = await mapReads.run(() => read(entry.variablesReference, 0, 3), current);
        if (current()) receive(index, page.limited ? null : mapEntryPair(page.items));
      } catch (error) { if (current()) receive(index, null, String(error)); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
}
