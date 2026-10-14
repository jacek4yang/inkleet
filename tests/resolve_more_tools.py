"""Resolve official distribution metadata. No binaries are executed."""
import json, pathlib, urllib.request, hashlib
OUT = pathlib.Path("evidence"); OUT.mkdir(exist_ok=True)
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent":"InkLeet-distribution-review","Accept":"application/json"}), timeout=60) as response:
        return response.read()
def data(url): return json.loads(get(url))
packages = []
release = next(r for r in data("https://go.dev/dl/?mode=json") if r["stable"])
for platform, os_name, arch in [("linux-x64","linux","amd64"),("windows-x64","windows","amd64"),("macos-x64","darwin","amd64"),("macos-arm64","darwin","arm64")]:
    artifact = next(f for f in release["files"] if f["os"]==os_name and f["arch"]==arch and f["kind"]=="archive")
    packages.append(dict(id="go",platform=platform,version=release["version"],url="https://go.dev/dl/"+artifact["filename"],sha256=artifact["sha256"],size=artifact["size"],archive="zip" if os_name=="windows" else "tar-gz",prefix="go",entry="bin/go.exe" if os_name=="windows" else "bin/go",license="BSD-3-Clause; LICENSE retained"))
for platform, os_name, arch in [("linux-x64","linux","x64"),("windows-x64","windows","x64"),("macos-x64","mac","x64"),("macos-arm64","mac","aarch64")]:
    releases=data(f"https://api.adoptium.net/v3/assets/latest/25/hotspot?architecture={arch}&image_type=jdk&os={os_name}&vendor=eclipse")
    candidate=next(r for r in releases if r["binary"]["image_type"]=="jdk")
    artifact=candidate["binary"]["package"]
    prefix=candidate["release_name"]
    packages.append(dict(id="jdk",platform=platform,version=candidate["version"]["semver"],url=artifact["link"],sha256=artifact["checksum"],size=artifact["size"],archive="zip" if os_name=="windows" else "tar-gz",prefix=prefix,entry=("Contents/Home/" if os_name=="mac" else "")+("bin/java.exe" if os_name=="windows" else "bin/java"),license="GPL-2.0 with Classpath Exception; licenses retained"))
for repository, version, tool, selections in [
    ("clangd/clangd","23.1.0","clangd",[("linux-x64","clangd-linux-23.1.0.zip"),("windows-x64","clangd-windows-23.1.0.zip"),("macos-x64","clangd-mac-23.1.0.zip"),("macos-arm64","clangd-mac-23.1.0.zip")]),
    ("vadimcn/codelldb","v1.12.3","codelldb",[("linux-x64","codelldb-linux-x64.vsix"),("windows-x64","codelldb-win32-x64.vsix"),("macos-x64","codelldb-darwin-x64.vsix"),("macos-arm64","codelldb-darwin-arm64.vsix")]),
    ("go-delve/delve","v1.27.2","delve",[("linux-x64","dlv_1.27.2_linux_amd64.tar.gz"),("windows-x64","dlv_1.27.2_windows_amd64.zip"),("macos-x64","dlv_1.27.2_darwin_amd64.tar.gz"),("macos-arm64","dlv_1.27.2_darwin_arm64.tar.gz")]),
]:
    release=data(f"https://api.github.com/repos/{repository}/releases/tags/{version}")
    assets={a["name"]:a for a in release["assets"]}
    checksums={}
    if "checksums.txt" in assets:
        for line in get(assets["checksums.txt"]["browser_download_url"]).decode().splitlines():
            fields=line.split()
            if len(fields)==2: checksums[fields[1].lstrip("*")]=fields[0]
    for platform,name in selections:
        artifact=assets[name];digest=artifact.get("digest")
        sha=digest.split(":",1)[1] if digest and digest.startswith("sha256:") else checksums[name]
        prefix="clangd_23.1.0" if tool=="clangd" else "extension" if tool=="codelldb" else ""
        entry=("bin/clangd" if tool=="clangd" else "adapter/codelldb" if tool=="codelldb" else "dlv")+(".exe" if platform=="windows-x64" else "")
        packages.append(dict(id=tool,platform=platform,version=version,url=artifact["browser_download_url"],sha256=sha,size=artifact["size"],archive="tar-gz" if name.endswith(".tar.gz") else "zip",prefix=prefix,entry=entry,license="Apache-2.0 with LLVM exceptions" if tool=="clangd" else "MIT and bundled LLVM/Python licenses" if tool=="codelldb" else "MIT; LICENSE retained"))
for package in packages:
    assert len(package["sha256"])==64 and package["size"]>0
(OUT/"more-tool-packages.json").write_text(json.dumps(packages,indent=2)+"\n")
print(json.dumps([{"id":p["id"],"platform":p["platform"],"version":p["version"],"size":p["size"]} for p in packages],indent=2))
