import { test } from "node:test";
import assert from "node:assert/strict";
import { DraftBook, languages, draftKey, createSnapshot, belongsToCurrent, SubmissionGate, reconcileText } from "../src/domain.ts";
const key = { account: "local", problem: "sample-sum", language: "rust" } as const;
test("六种语言草稿独立且可恢复", () => {
  const book = new DraftBook();
  for (const l of languages) book.edit({ ...key, language: l.id }, l.label, 2);
  for (const l of languages) assert.equal(book.read({ ...key, language: l.id }).code, l.label);
  assert.equal(book.read({ ...key, problem: "other" }).code, "");
  assert.equal(book.read({ ...key, account: "other" }).code, "");
});
test("草稿键无分隔符碰撞", () => {
  assert.notEqual(draftKey({ ...key, account: "a:b", problem: "c" }), draftKey({ ...key, account: "a", problem: "b:c" }));
});
test("评测快照不受后续编辑影响", () => {
  const book = new DraftBook();
  const old = book.edit(key, "old", 1);
  const snapshot = createSnapshot(key, old, "online-run", "[]", "operation-1");
  const result = { state: "finished" as const, snapshot, message: "example output" };
  assert.equal(belongsToCurrent(result, key, old), true);
  const current = book.edit(key, "new", 100);
  assert.equal(snapshot.code, "old");
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(current.cursor, 3);
  assert.equal(belongsToCurrent(result, key, current), false);
  assert.equal(belongsToCurrent(result, { ...key, account: "other" }, old), false);
});
test("提交未知时阻止跨语言重发，旧回调不能解除新锁", () => {
  const gate = new SubmissionGate();
  const draft = { code: "", cursor: 0, revision: 0 };
  const a = createSnapshot(key, draft, "submission", "", "a");
  const b = createSnapshot({ ...key, language: "cpp" }, draft, "submission", "", "b");
  gate.begin(a);
  assert.throws(() => gate.begin(b));
  assert.equal(gate.isPending(key), true);
  gate.settle(a);
  gate.begin(b);
  gate.settle(a);
  assert.equal(gate.isPending(key), true);
  gate.settle(b);
  assert.equal(gate.isPending(key), false);
});
test("无冲突同步，有冲突保留双方", () => {
  assert.deepEqual(reconcileText("a", "a", "b"), { state: "clean", text: "b" });
  assert.deepEqual(reconcileText("a", "b", "a"), { state: "clean", text: "b" });
  assert.deepEqual(reconcileText("a", "b", "c"), { state: "conflict", local: "b", external: "c" });
  assert.deepEqual(reconcileText("a", "", ""), { state: "clean", text: "" });
});
test("无效语言与操作 ID 拒绝", () => {
  assert.throws(() => draftKey({ ...key, language: "shell" } as any));
  assert.throws(() => createSnapshot(key, { code: "", cursor: 0, revision: 0 }, "submission", "", ""));
});
