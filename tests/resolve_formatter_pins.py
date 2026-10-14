"""Resolve fixed formatter releases from official manifests; inspect archives, never execute."""
import hashlib, io, json, pathlib, tarfile, tomllib, urllib.parse, urllib.request, zipfile
RUST = "1.99.0"
RUFF = "0.17.0"
HOSTS = {"static.rust-lang.org", "api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}
def get(url):
    parsed = urllib.parse.urlsplit(url)
    assert parsed.scheme == "https" and parsed.hostname in HOSTS
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "InkLeet-format-pin-review"}), timeout=90) as response:
        final = urllib.parse.urlsplit(response.url)
        assert final.scheme == "https" and final.hostname in HOSTS
        return response.read()
def inspected(url, digest, prefix, entry, archive):
    raw = get(url)
    assert hashlib.sha256(raw).hexdigest() == digest, "vendor archive digest mismatch"
    if archive == "zip":
        with zipfile.ZipFile(io.BytesIO(raw)) as z: names = z.namelist()
    else:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as z: names = z.getnames()
    assert ((prefix + "/") if prefix else "") + entry in names, (url, prefix, entry)
    return len(raw)
channel = tomllib.loads(get(f"https://static.rust-lang.org/dist/channel-rust-{RUST}.toml").decode())
release = json.loads(get(f"https://api.github.com/repos/astral-sh/ruff/releases/tags/{RUFF}"))
assets = {item["name"]:item for item in release["assets"]}
pins = []
for platform, triple in [("linux-x64","x86_64-unknown-linux-gnu"),("windows-x64","x86_64-pc-windows-msvc"),("macos-x64","x86_64-apple-darwin"),("macos-arm64","aarch64-apple-darwin")]:
    record = channel["pkg"]["rustfmt-preview"]["target"][triple]
    assert record["available"]
    url = record["url"]
    prefix = urllib.parse.urlsplit(url).path.rsplit("/",1)[-1].removesuffix(".tar.gz")
    entry = "rustfmt-preview/bin/rustfmt" + (".exe" if platform == "windows-x64" else "")
    size = inspected(url, record["hash"], prefix, entry, "tar-gz")
    pins.append(dict(id="rustfmt-preview",platform=platform,version=RUST,url=url,sha256=record["hash"],size=size,archive="tar-gz",prefix=prefix,entry=entry,license="MIT OR Apache-2.0"))
    prefix = "ruff-" + triple
    archive = "zip" if platform == "windows-x64" else "tar-gz"
    filename = prefix + (".zip" if archive == "zip" else ".tar.gz")
    asset = assets[filename]
    digest = get(assets[filename+".sha256"]["browser_download_url"]).decode().split()[0]
    assert len(digest) == 64 and all(c in "0123456789abcdef" for c in digest)
    assert asset.get("digest") in (None, "sha256:" + digest)
    entry = "ruff.exe" if platform == "windows-x64" else "ruff"
    if platform == "windows-x64": prefix = ""
    size = inspected(asset["browser_download_url"],digest,prefix,entry,archive)
    assert size == asset["size"]
    pins.append(dict(id="ruff",platform=platform,version=RUFF,url=asset["browser_download_url"],sha256=digest,size=size,archive=archive,prefix=prefix,entry=entry,license="MIT"))
pathlib.Path("evidence").mkdir(exist_ok=True)
pathlib.Path("evidence/formatter-pins.json").write_text(json.dumps(pins,indent=2)+"\n")
print("Verified formatter archive hashes and entry layouts for all four desktop targets; nothing executed.")
