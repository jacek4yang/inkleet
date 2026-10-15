import test from "node:test";
import assert from "node:assert/strict";
import {CompletionRequestOwner} from "../src/completion-request-owner.ts";
test("only issued tickets cancel, once, with exact session and issuer",()=>{
  const sent:unknown[]=[];const owner=new CompletionRequestOwner(async(id,n)=>{sent.push([id,n]);});
  owner.cancelActive();owner.cancel(null);assert.deepEqual(sent,[]);
  const a=owner.begin(9,1);owner.cancel(a);owner.cancel(a);owner.finish(a);
  assert.deepEqual(sent,[[9,1]]);
});
test("late abort and finally cannot cancel or clear replacement",()=>{
  const sent:unknown[]=[];const owner=new CompletionRequestOwner(async(id,n)=>{sent.push([id,n]);});
  const a=owner.begin(9,1),b=owner.begin(9,2);
  owner.finish(a);owner.cancel(a);assert.deepEqual(sent,[[9,1]]);
  owner.cancelActive();assert.deepEqual(sent,[[9,1],[9,2]]);owner.finish(b);
});
test("settled success does not send cancellation and new sessions stay isolated",()=>{
  const sent:unknown[]=[];const owner=new CompletionRequestOwner(async(id,n)=>{sent.push([id,n]);});
  const a=owner.begin(9,1);owner.finish(a);owner.cancel(a);owner.cancelActive();assert.deepEqual(sent,[]);
  const b=owner.begin(10,1);owner.cancel(a);owner.cancelActive();assert.deepEqual(sent,[[10,1]]);owner.finish(b);
});
test("invalid ownership cannot supersede a valid request",()=>{
  const sent:unknown[]=[];const owner=new CompletionRequestOwner(async(id,n)=>{sent.push([id,n]);});
  owner.begin(9,1);for(const [id,n] of [[0,1],[9,0],[9,Infinity],[9,Number.MAX_SAFE_INTEGER+1]])
    assert.throws(()=>owner.begin(id,n));
  assert.deepEqual(sent,[]);owner.cancelActive();assert.deepEqual(sent,[[9,1]]);
});
test("cancellation transport rejection is bounded and does not retry",async()=>{
  let calls=0;const owner=new CompletionRequestOwner(async()=>{calls++;throw Error("disconnected");});
  const a=owner.begin(9,1);owner.cancel(a);owner.cancel(a);await Promise.resolve();assert.equal(calls,1);
});
