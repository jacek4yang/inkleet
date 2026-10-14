// Coalesce pending snapshots per file while keeping writes globally ordered.
// Errors stay blocked until the user explicitly retries; other files can still save.
export type SaveJob = { key: string; write: () => Promise<void>; saved: () => void; failed: (error: unknown) => void };
export class SaveQueue {
  private pending = new Map<string, SaveJob>();
  private blocked = new Set<string>();
  private running = false;
  private active: string | undefined;
  private settled: Promise<void> = Promise.resolve();
  private settle: (() => void) | undefined;
  get idle() { return this.settled; }
  get busy() { return this.running || this.pending.size > 0 || this.blocked.size > 0; }
  failed(key: string) { return this.blocked.has(key); }
  enqueue(job: SaveJob) {
    this.pending.set(job.key, job);
    this.schedule();
  }
  block(key: string) { this.blocked.add(key); }
  discard(key: string) {
    if (this.active === key) throw new Error("不能丢弃正在写入的快照");
    this.pending.delete(key); this.blocked.delete(key);
  }
  retry(key: string) { this.blocked.delete(key); this.schedule(); }
  private schedule() {
    if (this.running || ![...this.pending.keys()].some(key => !this.blocked.has(key))) return;
    this.running = true;
    this.settled = new Promise(resolve => { this.settle = resolve; });
    queueMicrotask(() => { void this.pump(); });
  }
  private async pump() {
    try {
      while (true) {
        const entry = [...this.pending].find(([key]) => !this.blocked.has(key));
        if (!entry) break;
        const [key, job] = entry; this.pending.delete(key); this.active = key;
        try { await job.write(); job.saved(); }
        catch (error) {
          this.blocked.add(key);
          if (!this.pending.has(key)) this.pending.set(key, job);
          job.failed(error);
        } finally { this.active = undefined; }
      }
    } finally { this.running = false; this.settle?.(); this.settle = undefined; }
  }
}
