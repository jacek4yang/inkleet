/** Compare only fields emitted by the language-service diagnostic normalizer. */
export type VisibleDiagnostic = {
  from: number; to: number; severity: string; message: string; source?: string;
};
export type DiagnosticSnapshot<T> = {doc: T; items: readonly VisibleDiagnostic[]};
export function unchangedDiagnostics<T>(previous: DiagnosticSnapshot<T> | null, doc: T, items: readonly VisibleDiagnostic[]): boolean {
  if (!previous || previous.doc !== doc || previous.items.length !== items.length) return false;
  return items.every((item,index) => {
    const old=previous.items[index];
    return item.from===old.from && item.to===old.to && item.severity===old.severity &&
      item.message===old.message && item.source===old.source;
  });
}
