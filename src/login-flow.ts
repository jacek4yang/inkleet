export type QrState = "WAITING" | "SUCCEED" | "EXPIRED" | "INVALID" | "FAILED";
export function retryDelay(error: unknown, failures: number): number | null {
  if (String(error).includes("RATE_LIMIT_PAUSE")) return null;
  const match = String(error).match(/RATE_LIMIT:(\d+)/);
  if (match) { const seconds = Number(match[1]); return seconds > 600 ? null : Math.max(1_000, seconds * 1_000); }
  return Math.min(30_000, 1_000 * 2 ** Math.min(5, Math.max(0, failures)));
}
export function shouldRefresh(state: string, refreshes: number): boolean {
  return (state === "EXPIRED" || state === "INVALID") && refreshes < 3;
}
