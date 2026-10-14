/** Serial document work. A failed operation rejects its own caller only.
 * No automatic retries, timers, or background restarts are introduced.
 */
export class DocumentSyncQueue {
  private tail: Promise<void> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
