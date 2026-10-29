import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceActions,sourceActionChanges} from '../src/code-action-model.ts';
const edit=(line:number,start:number,end:number,newText='mut ')=>({range:{start:{line,character:start},end:{line,character:end}},newText});
test('code actions preserve exact edits, Unicode and multiline data',()=>{
 const text='a😀z\nlet value=1;';
 assert.deepEqual(sourceActionChanges(text,[edit(1,4,4),edit(0,1,3,'中')]),[{from:1,to:3,insert:'中'},{from:9,to:9,insert:'mut '}]);
 assert.equal(sourceActionChanges('x',[edit(0,0,1,'a'.repeat(65536))])[0].insert.length,65536);
});
test('code actions refuse stale-looking malformed and overlapping ranges',()=>{
 for(const value of [null,[],[edit(0,2,3)],[edit(0,1,9)],[edit(1,0,0)],[edit(0,3,1)],[edit(0,0,1),edit(0,0,0)],[{...edit(0,0,1),annotationId:'requires-review'}],[edit(0,0,1,'x'.repeat(65537))]]){
  assert.throws(()=>sourceActionChanges('a😀z',value),JSON.stringify(value));
 }
});
test('code action descriptors are bounded unique server-issued tokens',()=>{
 assert.deepEqual(sourceActions([{token:1,title:'Extract variable',kind:'refactor.extract',preferred:true}]),[{token:1,title:'Extract variable',kind:'refactor.extract',preferred:true}]);
 for(const value of [[{token:0,title:'x',kind:'quickfix'}],[{token:1,title:'x',kind:'source.organizeImports'}],[{token:1,title:'x',kind:'quickfix'},{token:1,title:'x',kind:'quickfix'}],Array(65).fill({token:1,title:'x',kind:'quickfix'})])assert.throws(()=>sourceActions(value));
});
