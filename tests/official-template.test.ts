import {test} from "node:test";
import assert from "node:assert/strict";
import {officialTemplate} from "../src/official-template.ts";
test("六语言官方模板逐字保留导入、Unicode、CRLF 和末尾换行",()=>{
 const sources=[
  ["rust","use std::collections::HashMap;\r\nimpl Solution {}\r\n"],
  ["python3","from __future__ import annotations\nfrom collections import Counter\n# 中文\n"],
  ["java","import java.util.HashMap;\nclass Solution {}\n"],
  ["c","#include <stdlib.h>\nint solve(int n) { return n; }\n"],
  ["cpp","#include <unordered_map>\nclass Solution {};\n"],
  ["golang","import \"fmt\"\nfunc solve(n int) int { return n }\n"]
 ].map(([langSlug,code])=>({langSlug,code}));
 for(const source of sources)assert.equal(officialTemplate(sources,source.langSlug),source.code);
 assert.equal(officialTemplate(sources,"unknown"),null);
 assert.equal(officialTemplate(null,"rust"),null);
 assert.equal(officialTemplate([{langSlug:"rust",code:" "}],"rust"),null);
 assert.equal(officialTemplate([{langSlug:"rust",code:"a"},{langSlug:"rust",code:"b"}],"rust"),null);
});
