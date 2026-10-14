import test from "node:test";
import assert from "node:assert/strict";
import { SaveQueue } from "../src/save-queue.ts";
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
test("coalesces the newest pending snapshot without reordering files", async () => {
  const queue = new SaveQueue(), gate = deferred(), writes: string[] = [];
  const job = (key: string, text: string, wait = Promise.resolve()) => ({ key, write: async () => { writes.push(text); await wait; }, saved() {}, failed(error: unknown) { throw error; } });
  queue.enqueue(job("a", "a1", gate.promise));
  await Promise.resolve();
  queue.enqueue(job("a", "a2")); queue.enqueue(job("b", "b1")); queue.enqueue(job("a", "a3"));
  gate.resolve(); await queue.idle;
  assert.deepEqual(writes, ["a1", "a3", "b1"]); assert.equal(queue.busy, false);
});
test("failed file retains the newest draft and never retries without explicit action", async () => {
  const queue = new SaveQueue(); let attempts = 0; const saved: string[] = [];
  queue.enqueue({ key: "a", write: async () => { ++attempts; throw Error("conflict"); }, saved() {}, failed() {} });
  await queue.idle;
  queue.enqueue({ key: "a", write: async () => { ++attempts; saved.push("newest"); }, saved() {}, failed() {} });
  queue.enqueue({ key: "b", write: async () => { saved.push("other"); }, saved() {}, failed() {} });
  await queue.idle;
  assert.equal(attempts, 1); assert.equal(queue.failed("a"), true); assert.deepEqual(saved, ["other"]);
  queue.retry("a"); await queue.idle;
  assert.equal(attempts, 2); assert.deepEqual(saved, ["other", "newest"]); assert.equal(queue.busy, false);
});

test("explicit conflict resolution discards only the blocked snapshot", async () => {
  const queue = new SaveQueue(); const writes: string[] = [];
  queue.enqueue({ key: "conflict", write: async () => { throw Error("changed"); }, saved() {}, failed() {} });
  await queue.idle; queue.discard("conflict");
  assert.equal(queue.failed("conflict"), false); assert.equal(queue.busy, false);
  queue.enqueue({ key: "conflict", write: async () => { writes.push("new"); }, saved() {}, failed() {} });
  await queue.idle; assert.deepEqual(writes, ["new"]);
});
test("cannot discard a write already in flight", async () => {
  const queue = new SaveQueue(), gate = deferred();
  queue.enqueue({ key: "a", write: () => gate.promise, saved() {}, failed() {} });
  await Promise.resolve(); assert.throws(() => queue.discard("a"), /正在写入/);
  gate.resolve(); await queue.idle; queue.discard("a");
});
