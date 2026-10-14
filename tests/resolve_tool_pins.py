"""Maintainer-only pin resolver. Never run by the application or as an installer."""
import hashlib, json, pathlib, urllib.request
VERSION = "v24.21.0"
BASE = f"https://nodejs.org/dist/{VERSION}/"
def fetch(url):
    with urllib.request.urlopen(url, timeout=90) as response:
        if not response.url.startswith(BASE):
            raise RuntimeError("Unexpected Node distribution redirect")
        return response.read()
checksums = {}
for line in fetch(BASE + "SHASUMS256.txt").decode().splitlines():
    digest, name = line.split()
    checksums[name] = digest
pins = []
for platform, suffix in [
    ("linux-x64", "linux-x64"), ("macos-x64", "darwin-x64"),
    ("macos-arm64", "darwin-arm64"), ("windows-x64", "win-x64"),
]:
    name = f"node-{VERSION}-{suffix}.tar.gz" if platform != "windows-x64" else "win-x64/node.exe"
    content = fetch(BASE + name)
    digest = hashlib.sha256(content).hexdigest()
    assert digest == checksums[name], f"Node checksum mismatch: {name}"
    pins.append(dict(id="node", platform=platform, version=VERSION[1:], url=BASE+name,
        sha256=digest, size=len(content), archive="raw" if platform=="windows-x64" else "tar-gz",
        prefix="" if platform=="windows-x64" else f"node-{VERSION}-{suffix}",
        entry="node.exe" if platform=="windows-x64" else "bin/node", license="MIT and bundled third-party licenses"))
pathlib.Path("evidence").mkdir(exist_ok=True)
pathlib.Path("evidence/node-packages.json").write_text(json.dumps(pins, indent=2)+"\n")
print("Verified four fixed-version Node distributions against vendor SHA256 manifest.")
