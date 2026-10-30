// Created ONLY by the verified same-user standard-integrity CI child.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile,realpath} from 'node:fs/promises';
import path from 'node:path';
const c=JSON.parse(await readFile(process.argv[2],'utf8'));
assert.equal(process.platform,'win32');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(c.phase,'prepare');
assert.match(c.harnessCommit,/^[0-9a-f]{40}$/);assert.match(c.userSid,/^S-1-5-21-\d+-\d+-\d+-\d+$/);
assert.equal(path.resolve(c.appData),path.resolve(process.env.APPDATA,'top.jacek.inkleet'));
assert.equal(path.resolve(c.appCache),path.resolve(process.env.LOCALAPPDATA,'top.jacek.inkleet'));
assert.equal(await realpath(path.dirname(c.temporary)),await realpath(process.env.RUNNER_TEMP));assert.match(path.basename(c.temporary),/^InkLeet MSI acceptance [0-9a-f]{32}$/);
for(const root of new Set([c.temporary,c.appData,c.appCache])){await mkdir(root);await writeFile(path.join(root,'.inkleet-ci-owned'),c.harnessCommit,{flag:'wx'});}
const profile=path.join(c.temporary,'WebView2 synthetic profile');await mkdir(profile);await writeFile(path.join(profile,'.inkleet-ci-owned'),c.harnessCommit,{flag:'wx'});
await copyFile(path.join(process.cwd(),'tests/fixtures/public-questions.json'),path.join(c.appCache,'public-questions.json'));
await writeFile(path.join(c.appData,'editor-settings.json'),JSON.stringify({version:1,formatOnSave:false,overrides:{}}),{flag:'wx'});
await writeFile(path.join(c.evidence,'prepare-owned-paths.json'),JSON.stringify({harnessCommit:c.harnessCommit,userSid:c.userSid,paths:[c.temporary,c.appData,c.appCache,profile]},null,2));
