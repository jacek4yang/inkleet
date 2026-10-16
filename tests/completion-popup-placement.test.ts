import test from "node:test";
import assert from "node:assert/strict";
import {placeCompletionInfo} from "../src/completion-popup-placement.ts";
const space={left:0,top:0,right:1200,bottom:800};
test("docs prefer reading-direction side and remain outside list",()=>{
 const list={left:400,top:200,right:680,bottom:500},option={...list,bottom:228};
 const right=placeCompletionInfo(list,option,space)!;assert.equal(right.mode,"right");assert.ok(right.x>=list.right+8);assert.ok(right.x+right.width<=1192);
 const left=placeCompletionInfo(list,option,space,true)!;assert.equal(left.mode,"left");assert.ok(left.x+left.width<=list.left-8);
});
test("narrow view stacks below entire list or above without overlapping",()=>{
 const small={left:0,top:0,right:400,bottom:700};
 const list={left:20,top:100,right:380,bottom:350};
 const below=placeCompletionInfo(list,{...list,bottom:128},small)!;assert.equal(below.mode,"below");assert.equal(below.edge,358);
 const upper=placeCompletionInfo({...list,top:400,bottom:650},list,small)!;assert.equal(upper.mode,"above");assert.equal(upper.anchor,"bottom");assert.equal(upper.edge,392);
});
test("offset spaces zoom and tiny viewports fail safely",()=>{
 const space={left:100,top:80,right:700,bottom:600},list={left:120,top:200,right:400,bottom:450};
 const p=placeCompletionInfo(list,list,space,false,1.25,1.25)!;assert.ok(p.x>=108);assert.ok(p.x+p.width<=692);assert.ok(p.maxHeight<=350);
 assert.equal(placeCompletionInfo({left:0,top:0,right:100,bottom:100},{left:0,top:0,right:100,bottom:100},{left:0,top:0,right:100,bottom:100}),null);
 assert.equal(placeCompletionInfo(list,list,space,false,0),null);
});
