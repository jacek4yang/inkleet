import test from "node:test";
import assert from "node:assert/strict";
import {codicons} from "../src/codicons.ts";
test("bundled IDE SVG geometry preserves view boxes and compound fill rules",()=>{
 assert.equal(Object.keys(codicons).length,33);
 for(const [name,asset]of Object.entries(codicons)){
  assert.ok(["0 0 16 16","0 0 24 24"].includes(asset.viewBox),name);
  assert.ok(asset.paths.length>0,name);
  for(const path of asset.paths)assert.ok(path.d.length>0,name);
 }
 assert.equal(codicons.lock.paths.length,2);
 assert.equal(codicons.lock.paths[1].fillRule,"evenodd");
 assert.equal(codicons.lock.paths[1].clipRule,"evenodd");
 assert.equal(codicons.terminal.viewBox,"0 0 24 24");
 for(const name of ["next","into","out","play","pause","stop"])assert.equal(codicons[name].viewBox,"0 0 16 16");
});
