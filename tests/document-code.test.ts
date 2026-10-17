import test from "node:test";
import assert from "node:assert/strict";
import { boundedCandidates, CODE_LIMITS, codeLanguage, validCandidate, validatedHighlights } from "../src/document-code-model.ts";

test("documentation code languages are explicit, bounded and normalize aliases", () => {
  for (const [input, expected] of [[" Rust ", "rust"], ["rs", "rust"], ["PYTHON3", "python"], ["py", "python"], ["py3", "python"], ["golang", "go"], ["go", "go"], ["C", "cpp"], ["c++", "cpp"], ["cc", "cpp"], ["cxx", "cpp"], ["java example", "java"]]) {
    assert.equal(codeLanguage(input), expected);
  }
  for (const value of [null, {}, 1, "", "text", "javascript", "java\" onclick=", "r".repeat(81)]) assert.equal(codeLanguage(value), null);
});

test("documentation code candidate budgets retain complete code and skip over-limit blocks", () => {
  const make = (id: string, length: number) => ({ id, language: "rust" as const, text: "x".repeat(length) });
  const source = [make("large", 8193), ...Array.from({ length: 5 }, (_, index) => make("block-" + index, 8192))];
  assert.deepEqual(boundedCandidates(source).map(value => value.id), ["block-0", "block-1", "block-2", "block-3"]);
  assert.equal(boundedCandidates(Array.from({ length: 40 }, (_, index) => make("id-" + index, 1))).length, CODE_LIMITS.blocks);
  assert.deepEqual(boundedCandidates([make("same", 1), make("same", 1)]).map(value => value.id), ["same"]);
  assert.equal(validCandidate({ id: "bad\"", language: "rust", text: "x" }), false);
  assert.equal(validCandidate({ id: "empty", language: "rust", text: "" }), false);
  assert.equal(validCandidate({ id: "alias", language: "rs", text: "x" }), false);
});

test("documentation highlight ranges are ordered, bounded and preserve UTF-16 pairs", () => {
  const candidates = [{ id: "one", language: "rust" as const, text: "fn 😀x" }];
  const range = { from: 0, to: 2, token: "keyword" };
  const good = [{ id: "one", ranges: [range, { from: 3, to: 5, token: "string" }] }];
  assert.deepEqual(validatedHighlights(good, candidates), good);
  assert.deepEqual(validatedHighlights([], candidates), []);
  for (const ranges of [
    [{ ...range, from: -1 }], [{ ...range, to: 7 }], [{ ...range, to: 0 }],
    [{ ...range, to: 1.5 }], [{ ...range, token: "onclick" }],
    [range, { ...range, from: 1 }], [{ from: 3, to: 4, token: "string" }],
    [{ from: 4, to: 5, token: "string" }],
  ]) assert.equal(validatedHighlights([{ id: "one", ranges }], candidates), null);
  assert.equal(validatedHighlights([{ id: "unknown", ranges: [] }], candidates), null);
  assert.equal(validatedHighlights([{ id: "one", ranges: [] }, { id: "one", ranges: [] }], candidates), null);
  assert.equal(validatedHighlights([{ id: "one", ranges: Array(CODE_LIMITS.ranges + 1).fill(range) }], candidates), null);
  assert.equal(validatedHighlights({ highlights: good }, candidates), null);
});
