"""Inspect the official pinned VSIX distribution; do not execute extension code."""
import hashlib,io,json,pathlib,urllib.request,zipfile
url="https://marketplace.visualstudio.com/_apis/public/gallery/publishers/vscjava/vsextensions/vscode-java-debug/0.59.0/vspackage"
request=urllib.request.Request(url,headers={"Accept":"application/octet-stream","User-Agent":"InkLeet-package-verifier"})
with urllib.request.urlopen(request,timeout=120) as response:
    final=response.url
    raw=response.read(64*1024*1024+1)
if len(raw)>64*1024*1024:raise RuntimeError("VSIX exceeds limit")
archive=zipfile.ZipFile(io.BytesIO(raw))
package=json.loads(archive.read("extension/package.json"))
assert package["publisher"]=="vscjava" and package["name"]=="vscode-java-debug" and package["version"]=="0.59.0"
entry="extension/server/com.microsoft.java.debug.plugin-0.53.2.jar"
plugin=archive.read(entry)
jar=zipfile.ZipFile(io.BytesIO(plugin))
manifest=jar.read("META-INF/MANIFEST.MF").decode()
assert "com.microsoft.java.debug.plugin" in manifest
result={"id":"java-debug","version":"0.53.2 (VSIX 0.59.0)","url":url,"finalUrl":final,"sha256":hashlib.sha256(raw).hexdigest(),"size":len(raw),"archive":"zip","prefix":"extension","entry":"server/com.microsoft.java.debug.plugin-0.53.2.jar","pluginSha256":hashlib.sha256(plugin).hexdigest(),"license":"EPL-1.0 (Java debug plugin); MIT (VSIX wrapper)"}
pathlib.Path("evidence").mkdir(exist_ok=True)
pathlib.Path("evidence/java-debug-pin.json").write_text(json.dumps(result,indent=2))
pathlib.Path("evidence/java-debug-manifest.txt").write_text(manifest)
print("JAVA_DEBUG_PIN "+json.dumps(result))
