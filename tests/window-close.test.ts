import assert from "node:assert/strict";import test from "node:test";import {readFile} from "node:fs/promises";
import {waitForCloseWrites} from "../src/window-close.ts";
test("main close continuation has its exact native permission and no remote scope",async()=>{
 const cap=JSON.parse(await readFile(new URL("../src-tauri/capabilities/main.json",import.meta.url),"utf8"));
 assert.deepEqual(cap.windows,["main"]);assert.equal(cap.remote,undefined);
 assert.ok(cap.permissions.includes("core:window:allow-destroy"));
});
test("close waits for saves and preserves failures",async()=>{
 let finish!:()=>void,settled=false;const write=new Promise<void>(resolve=>finish=resolve);
 const waiting=waitForCloseWrites(()=>write,1000).then(()=>settled=true);
 await Promise.resolve();assert.equal(settled,false);finish();await waiting;assert.equal(settled,true);
 await assert.rejects(waitForCloseWrites(()=>Promise.reject(Error("disk error")),1000),/disk error/);
});
test("timeout keeps late writes running but never authorizes a late exit",async()=>{
 let finish!:()=>void,written=false,exit=false;
 const write=new Promise<void>(resolve=>finish=resolve).then(()=>{written=true;});
 await assert.rejects(waitForCloseWrites(()=>write,5).then(()=>{exit=true;}),/保存仍未完成/);
 finish();await write;assert.equal(written,true);assert.equal(exit,false);
});
