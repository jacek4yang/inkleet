import type { DebugVariable } from "./debug-model";

export const VARIABLE_PAGE_SIZE = 100;
export const VARIABLE_NODE_LIMIT = 1000;
export type VariablePage = { items: DebugVariable[]; received: number; limited: boolean };
export type VariableReader = (reference: number, start?: number, count?: number) => Promise<VariablePage>;
export type RustVisualKind = "map" | "set" | "sequence" | "string" | "variant" | "pointer" | "generic";
/** A display hint only. Never reinterpret memory or infer a layout from a user's type name. */
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
export function mapEntryFields(items: DebugVariable[]): boolean {
  if (items.length !== 2) return false;
  return (items[0].name === "0" && items[1].name === "1") ||
    (items[0].name === ".0" && items[1].name === ".1") ||
    (items[0].name === "key" && items[1].name === "value");
}
