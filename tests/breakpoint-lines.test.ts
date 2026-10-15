import test from "node:test";
import assert from "node:assert/strict";
import {sameBreakpointLines} from "../src/breakpoint-lines.ts";
test("breakpoint notifications retain real line changes without per-key updates",()=>{
  assert.equal(sameBreakpointLines([],[]),true);
  assert.equal(sameBreakpointLines([1,3],[1,3]),true);
  for(const [a,b] of [[[1],[2]],[[1],[]],[[],[1]],[[1,3],[1,4]]])assert.equal(sameBreakpointLines(a,b),false);
});
