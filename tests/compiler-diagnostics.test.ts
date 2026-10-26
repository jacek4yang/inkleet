import test from "node:test";
import assert from "node:assert/strict";
import {parseCompilerDiagnostics,ownedDiagnosticLine,diagnosticExcerpt} from "../src/compiler-diagnostics.ts";

test("C/C++ and javac retain text and locations without treating paths as commands",()=>{
 const cpp=parseCompilerDiagnostics('solution.cpp:4:12: error: expected ";"\n  4 | return x\n    |            ^\nC:\\private\\header.h:9:3: warning: <script>alert(1)</script>',"cpp");
 assert.deepEqual(cpp.items,[{file:"solution.cpp",line:4,column:12,severity:"error",message:'expected ";"'},{file:"C:\\private\\header.h",line:9,column:3,severity:"warning",message:"<script>alert(1)</script>"}]);
 assert.deepEqual(parseCompilerDiagnostics("Solution.java:2: error: cannot find symbol","java").items,[{file:"Solution.java",line:2,severity:"error",message:"cannot find symbol"}]);
 assert.equal(parseCompilerDiagnostics("solution.c:1:2: fatal error: missing.h not found","c").items[0].severity,"error");
});
test("Rust headers associate with their following primary location, not a later block",()=>{
 const report=parseCompilerDiagnostics("\u001b[31merror[E0308]: mismatched types\u001b[0m\n --> solution.rs:3:9\n  |\n3 | let x = true;\n\nerror: aborting due to 1 previous error\n\n --> ignored.rs:8:1","rust");
 assert.deepEqual(report.items,[{file:"solution.rs",line:3,column:9,severity:"error",message:"mismatched types"}]);
});
test("Go line directives can omit columns; Python only summarizes syntax-family failures",()=>{
 assert.deepEqual(parseCompilerDiagnostics("# command-line-arguments\n./solution.go:7: undefined: x\nsolution.go:8:4: syntax error: unexpected }","golang").items,[{file:"./solution.go",line:7,severity:"error",message:"undefined: x"},{file:"solution.go",line:8,column:4,severity:"error",message:"syntax error: unexpected }"}]);
 const python='  File "solution.py", line 2\n    return (\n           ^\nSyntaxError: never closed';
 assert.equal(parseCompilerDiagnostics(python,"python3").items[0].line,2);
 assert.equal(parseCompilerDiagnostics('  File "harness.py", line 1, in run\n'+python,"python3").items.length,1);
 assert.equal(parseCompilerDiagnostics('  File "solution.py", line 1\nSyntaxError: '+"x".repeat(5000),"python3").items.length,0);
 assert.equal(parseCompilerDiagnostics('  File "solution.py", line 2, in foo\n    x()\nValueError: invalid',"python3").items.length,0);
});
test("unknown logs, unsupported languages and malformed numbers never fabricate diagnostics",()=>{
 for(const text of ["linker failed","hello:1:2: normal output","solution.cpp:0:2: error: invalid","solution.cpp:1:0: error: invalid","solution.cpp:9007199254740999:2: error: invalid"]){assert.deepEqual(parseCompilerDiagnostics(text,"cpp").items,[]);}
 assert.deepEqual(parseCompilerDiagnostics("solution.cpp:1:2: error: fail","unknown").items,[]);
});
test("ownership requires exact virtual filename, correct language and in-bounds snapshot line",()=>{
 const item={file:"solution.cpp",line:2,column:3,severity:"error" as const,message:"test"};
 for(const file of ["/tmp/run/solution.cpp","C:\\run\\solution.cpp","../solution.cpp","other/solution.cpp","https://a/solution.cpp","solution.cpp\u0000","Solution.cpp"]){assert.equal(ownedDiagnosticLine({...item,file},"cpp","one\ntwo"),null);}
 for(const [language,file] of Object.entries({cpp:"solution.cpp",c:"solution.c",rust:"solution.rs",golang:"solution.go",java:"Solution.java",python3:"solution.py"})){
  assert.equal(ownedDiagnosticLine({...item,file},language,"one\ntwo"),2);
 }
 assert.equal(ownedDiagnosticLine(item,"cpp","one\ntwo"),2);
 assert.equal(ownedDiagnosticLine({...item,file:"./solution.cpp"},"cpp","one\ntwo"),2);
 assert.equal(ownedDiagnosticLine(item,"c","one\ntwo"),null);
 assert.equal(ownedDiagnosticLine(item,"cpp","one"),null);
});
test("excerpts preserve whitespace and tabs without guessing column units",()=>{
 assert.deepEqual(diagnosticExcerpt("before\n\t中文😀();\nafter\nlast",2),[{line:1,text:"before",active:false},{line:2,text:"\t中文😀();",active:true},{line:3,text:"after",active:false}]);
 assert.deepEqual(diagnosticExcerpt("a",0),[]);
 assert.equal(diagnosticExcerpt("a".repeat(4000),1)[0].text,"a".repeat(4000));
});
test("parsing is bounded and leaves input unchanged for raw display/copy",()=>{
 const raw=Array.from({length:70},(_,i)=>`solution.cpp:${i+1}:1: error: failure`).join("\n");
 const report=parseCompilerDiagnostics(raw,"cpp");
 assert.equal(report.items.length,50);assert.equal(report.limited,true);assert.equal(raw.split("\n").length,70);
 assert.equal(parseCompilerDiagnostics("x".repeat(70000),"cpp").limited,true);
 assert.equal(parseCompilerDiagnostics("x".repeat(5000),"cpp").limited,true);
 assert.equal(parseCompilerDiagnostics("\n".repeat(2100),"cpp").limited,true);
});
