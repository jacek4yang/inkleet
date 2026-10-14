import test from "node:test";
import assert from "node:assert/strict";
import { DocumentSyncQueue } from "../src/document-sync-queue.ts";

test("failed caller keeps its error while later document work recovers in order", async()=>{
  const queue=new DocumentSyncQueue(), events:string[]=[];
  const first=queue.run(async()=>{events.push("failed");throw Error("sync failed");});
  const rejected=assert.rejects(first,/sync failed/);
  const second=queue.run(async()=>{events.push("updated");return 2;});
  const third=queue.run(async()=>{events.push("requested");return 3;});
  await rejected;assert.equal(await second,2);assert.equal(await third,3);
  assert.deepEqual(events,["failed","updated","requested"]);
});

test("newer work cannot pass an outstanding update; failed work is never replayed",async()=>{
  const queue=new DocumentSyncQueue();let reject!:(e:Error)=>void;
  const events:string[]=[];
  const first=queue.run(()=>{events.push("started");return new Promise<void>((_,r)=>{reject=r;});});
  const failed=assert.rejects(first,/offline/);
  const second=queue.run(async()=>{events.push("latest");});
  await Promise.resolve();assert.deepEqual(events,["started"]);
  reject(Error("offline"));await failed;await second;
  assert.deepEqual(events,["started","latest"]);
});

test("separate document queues never block each other",async()=>{
  const a=new DocumentSyncQueue(),b=new DocumentSyncQueue();let resolve!:()=>void;
  const pending=a.run(()=>new Promise<void>(r=>{resolve=r;}));
  assert.equal(await b.run(async()=>42),42);resolve();await pending;
});
