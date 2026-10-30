import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMsiPayload} from './windows-msi-payload.mjs';
const token='__TAURI_BUNDLE_TYPE_VAR_UNK',msi='__TAURI_BUNDLE_TYPE_VAR_MSI';
const built=()=>Buffer.from('MZ\x00authored-prefix\x00'+token+'\x00payload\xffsuffix','latin1');
const installed=()=>Buffer.from('MZ\x00authored-prefix\x00'+msi+'\x00payload\xffsuffix','latin1');
test('MSI exact bundle marker patch preserves every other byte and inputs',()=>{
 const source=built(),actual=installed(),before=Buffer.from(source),installedBefore=Buffer.from(actual),r=inspectMsiPayload(source,actual);
 assert.equal(r.result,'PASS');assert.equal(r.expected_sha256,r.installed_sha256);assert.notEqual(r.built_sha256,r.installed_sha256);assert.equal(r.built_bytes,r.installed_bytes);
 assert.deepEqual(source,before);assert.deepEqual(actual,installedBefore);
});
test('unpatched, NSIS marker, any other changed byte, truncate and append fail closed',()=>{
 const corrupt=installed();corrupt[0]^=1;
 for(const actual of [built(),Buffer.from(installed().toString('latin1').replace(msi,'__TAURI_BUNDLE_TYPE_VAR_NSS'),'latin1'),corrupt,installed().subarray(0,-1),Buffer.concat([installed(),Buffer.from([0])])]){
  const r=inspectMsiPayload(built(),actual);assert.equal(r.result,'FAIL');assert.notEqual(r.expected_sha256,r.installed_sha256);assert.ok(r.first_differing_offsets.length);
 }
});
test('missing or duplicate unknown marker cannot establish source identity',()=>{
 for(const source of [Buffer.from('no marker'),Buffer.concat([built(),Buffer.from(token)])])assert.equal(inspectMsiPayload(source,installed()).result,'FAIL');
});
test('arbitrary MSI-like constants are not normalized away',()=>{
 const source=Buffer.concat([built(),Buffer.from(msi)]),expected=Buffer.concat([installed(),Buffer.from(msi)]);
 assert.equal(inspectMsiPayload(source,expected).result,'PASS');expected[expected.length-1]^=1;assert.equal(inspectMsiPayload(source,expected).result,'FAIL');
});
