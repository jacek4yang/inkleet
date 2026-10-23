import type { EditorSettings } from "./format-settings.ts";
import { compareSettingsRows, settingsCategories, type RuntimeSettingsAction, type SettingsCategory, type SettingsRow } from "./settings-catalog.ts";
import { readEditorSettingState } from "./settings-state.ts";

export const MAX_SETTINGS_QUERY_LENGTH = 256;
export const MAX_SETTINGS_QUERY_TERMS = 12;
const MAX_INDEX_FIELD_LENGTH = 256;
export type SettingsSearchIssue = "query-too-long" | "too-many-terms" | "no-search-terms";
export type SettingsSearchOptions = Readonly<{
  category?: SettingsCategory;
  // The visible control must say "Modified editor settings". Downloads do not
  // participate, even when mounted; unmounted/unloaded never means default.
  modified?: "editor";
  editorDraft?: EditorSettings | null;
}>;
export type SettingsSearchResult<A extends RuntimeSettingsAction> = Readonly<{
  rows: readonly Readonly<{ row: SettingsRow<A>; match: "direct" | "supporting" }>[];
  directMatchCount: number;
  categoryCounts: Readonly<Record<SettingsCategory, number>>;
  issue: SettingsSearchIssue | null;
  modifiedScope: "editor" | null;
  modifiedState: "known" | "unknown" | null;
}>;

function normalize(value: string): string { return value.normalize("NFKC").toLowerCase().trim(); }
function terms(value: string): string[] {
  // Keep + and # in words: C++, C and C# must not collapse into the same token.
  return normalize(value).match(/[\p{L}\p{N}+#]+/gu) ?? [];
}
function matchesTerm(term: string, word: string): boolean {
  if (term.length === 1 || /[+#]/u.test(term)) return term === word;
  if (/\p{Script=Han}/u.test(term)) return word.includes(term);
  return word.startsWith(term);
}
function rowTerms(row: SettingsRow): readonly string[] {
  const category = settingsCategories.find(category => category.id === row.category)!;
  // Only this row's ID, live label, explicit aliases and category are indexed.
  // No descriptions, other rows, draft values or proxy URLs enter the index.
  const label = row.kind === "action" ? row.action.label : row.label;
  return [row.id, label, ...row.aliases, category.label, ...category.aliases]
    .flatMap(field => terms(field.slice(0, MAX_INDEX_FIELD_LENGTH)));
}

export function searchSettingsCatalog<A extends RuntimeSettingsAction>(
  catalog: readonly SettingsRow<A>[], query: string, options: SettingsSearchOptions = {},
): SettingsSearchResult<A> {
  const counts: Record<SettingsCategory, number> = { editor: 0, environment: 0, downloads: 0, files: 0, notes: 0, debug: 0 };
  const modifiedScope = options.modified ?? null;
  const modifiedState = modifiedScope ? (options.editorDraft ? "known" : "unknown") : null;
  const empty = (issue: SettingsSearchIssue | null): SettingsSearchResult<A> => ({
    rows: [], directMatchCount: 0, categoryCounts: counts, issue, modifiedScope, modifiedState,
  });
  // Reject excessive queries rather than truncating away an AND term and
  // reporting unrelated matches. All work after this point has small bounds.
  if (query.length > MAX_SETTINGS_QUERY_LENGTH) return empty("query-too-long");
  const normalized = normalize(query);
  const queryTerms = [...new Set(terms(normalized))];
  if (queryTerms.length > MAX_SETTINGS_QUERY_TERMS) return empty("too-many-terms");
  if (normalized && !queryTerms.length) return empty("no-search-terms");
  if (modifiedState === "unknown") return empty(null);

  const exactId = catalog.find(row => normalize(row.id) === normalized)?.id;
  const direct = catalog.filter(row => {
    if (options.category && row.category !== options.category) return false;
    if (modifiedScope) {
      if (row.owner !== "editor-settings") return false;
      const state = readEditorSettingState(options.editorDraft ?? null, row.id);
      if (state.status !== "known" || state.isDefault) return false;
    }
    if (!normalized) return true;
    if (exactId) return row.id === exactId;
    const words = rowTerms(row);
    return queryTerms.every(term => words.some(word => matchesTerm(term, word)));
  });
  const directIds = new Set(direct.map(row => row.id));
  for (const row of direct) counts[row.category]++;
  const displayed = [...direct];
  // Matching an address must still expose the actual mode selector required to
  // use it. Rendering may explain the dependency; this never changes the mode.
  if (directIds.has("downloads.proxy.url") && !directIds.has("downloads.proxy.mode")) {
    const mode = catalog.find(row => row.id === "downloads.proxy.mode");
    if (mode) displayed.push(mode);
  }
  return {
    rows: displayed.sort(compareSettingsRows).map(row => ({ row, match: directIds.has(row.id) ? "direct" : "supporting" })),
    directMatchCount: direct.length, categoryCounts: counts, issue: null, modifiedScope, modifiedState,
  };
}
