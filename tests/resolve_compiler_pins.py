"""Maintainer-only fixed-version metadata resolver. Outputs reviewable pins; executes nothing."""
import json, pathlib, urllib.request, urllib.parse, tomllib, hashlib, io, tarfile
RUST = "1.99.0"
ALLOWED = {"static.rust-lang.org", "ziglang.org", "pypi.org", "files.pythonhosted.org"}
def open_url(url, method="GET"):
    parsed=urllib.parse.urlsplit(url)
    assert parsed.scheme=="https" and parsed.hostname in ALLOWED
    response=urllib.request.urlopen(urllib.request.Request(url, method=method),timeout=90)
    final=urllib.parse.urlsplit(response.url)
    assert final.scheme=="https" and final.hostname in ALLOWED
    return response
def get(url):
    with open_url(url) as response: return response.read()
def size(url):
    with open_url(url,"HEAD") as response: return int(response.headers["Content-Length"])
channel=tomllib.loads(get(f"https://static.rust-lang.org/dist/channel-rust-{RUST}.toml").decode())
pins=[]
for platform,triple in [("linux-x64","x86_64-unknown-linux-gnu"),("windows-x64","x86_64-pc-windows-msvc"),("macos-x64","x86_64-apple-darwin"),("macos-arm64","aarch64-apple-darwin")]:
    for package,entry in [("rustc","rustc/bin/rustc"),("cargo","cargo/bin/cargo"),("rust-std",f"rust-std-{triple}/manifest.in"),("rust-analyzer-preview","rust-analyzer-preview/bin/rust-analyzer")]:
        component_triple="x86_64-pc-windows-gnu" if platform=="windows-x64" and package=="rust-std" else triple
        if package=="rust-std": entry=f"rust-std-{component_triple}/manifest.in"
        record=channel["pkg"][package]["target"][component_triple]
        assert record["available"]
        url=record["url"]
        prefix=urllib.parse.urlsplit(url).path.rsplit("/",1)[-1].removesuffix(".tar.gz")
        if platform=="windows-x64" and package!="rust-std":entry+=".exe"
        pins.append(dict(id=package,platform=platform,version=RUST,url=url,sha256=record["hash"],size=size(url),archive="tar-gz",prefix=prefix,entry=entry,license="MIT OR Apache-2.0"))

record=channel["pkg"]["rust-mingw"]["target"]["x86_64-pc-windows-gnu"]
assert record["available"], "Official Rust Windows linker component unavailable"
archive=get(record["url"])
assert hashlib.sha256(archive).hexdigest()==record["hash"], "Rust MinGW vendor hash mismatch"
prefix=urllib.parse.urlsplit(record["url"]).path.rsplit("/",1)[-1].removesuffix(".tar.gz")
with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as members:
    names=members.getnames()
    entry=next(name for name in names if name.endswith("/bin/self-contained/x86_64-w64-mingw32-gcc.exe"))
    assert all(any(name.endswith("/lib/self-contained/"+lib) for name in names) for lib in ["libpthread.a","libmsvcrt.a","libgcc_eh.a"])
    entry=entry.removeprefix(prefix+"/")
mingw=dict(id="rust-mingw",platform="windows-x64",version=RUST,url=record["url"],sha256=record["hash"],size=len(archive),archive="tar-gz",prefix=prefix,entry=entry,license="Rust MinGW bundled GCC/runtime licenses retained")
pins.append(mingw)
print("RUST_MINGW_PIN "+json.dumps(mingw))

record=channel["pkg"]["rust-src"]["target"]["*"]
pins.append(dict(id="rust-src",platform="any",version=RUST,url=record["url"],sha256=record["hash"],size=size(record["url"]),archive="tar-gz",prefix=f"rust-src-{RUST}",entry="rust-src/lib/rustlib/src/rust/library/std/src/lib.rs",license="MIT OR Apache-2.0"))
zig=json.loads(get("https://ziglang.org/download/index.json"))["0.17.0"]
for platform,target in [("linux-x64","x86_64-linux"),("windows-x64","x86_64-windows"),("macos-x64","x86_64-macos"),("macos-arm64","aarch64-macos")]:
    record=zig[target]; windows=platform=="windows-x64"
    pins.append(dict(id="zig",platform=platform,version="0.17.0",url=record["tarball"],sha256=record["shasum"],size=int(record["size"]),archive="zip" if windows else "tar-xz",prefix=f"zig-{target}-0.17.0",entry="zig.exe" if windows else "zig",license="MIT and bundled LLVM/compiler library licenses"))
debug=json.loads(get("https://pypi.org/pypi/debugpy/1.8.22/json"))
wheels=[dict(filename=r["filename"],url=r["url"],sha256=r["digests"]["sha256"],size=r["size"]) for r in debug["urls"] if r["filename"].endswith(".whl")]
pathlib.Path("evidence").mkdir(exist_ok=True)
pathlib.Path("evidence/rust-zig-pins.json").write_text(json.dumps(pins,indent=2)+"\n")
pathlib.Path("evidence/debugpy-wheel-candidates.json").write_text(json.dumps(wheels,indent=2)+"\n")
print("Resolved fixed Rust, Zig and debugpy distribution metadata. Not executed or installed.")
