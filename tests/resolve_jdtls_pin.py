"""Maintainer-only resolver; downloads pinned JDTLS bytes, never executes them."""
import hashlib, io, json, pathlib, re, tarfile, urllib.parse, urllib.request
VERSION = "1.61.0"
NAME = "jdt-language-server-1.61.0-202609031315.tar.gz"
BASE = "https://download.eclipse.org/jdtls/milestones/" + VERSION + "/"
def fetch(url, limit):
    request = urllib.request.Request(url, headers={"User-Agent": "InkLeet-maintainer-pin-verifier"})
    with urllib.request.urlopen(request, timeout=120) as response:
        final = urllib.parse.urlsplit(response.url)
        if final.scheme != "https" or final.hostname != "download.eclipse.org":
            raise RuntimeError("Unexpected Eclipse distribution redirect")
        data = response.read(limit + 1)
        if len(data) > limit:
            raise RuntimeError("Distribution exceeds verification budget")
        return data
checksum = fetch(BASE + NAME + ".sha256", 4096).decode("ascii").strip().split()[0]
assert re.fullmatch(r"[0-9a-fA-F]{64}", checksum), "Invalid vendor checksum"
content = fetch(BASE + NAME, 100 * 1024 * 1024)
assert hashlib.sha256(content).hexdigest() == checksum.lower(), "JDTLS checksum mismatch"
with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as archive:
    names = archive.getnames()
    launchers = [name for name in names if re.fullmatch(r"(?:\./)?plugins/org\.eclipse\.equinox\.launcher_[^/]+\.jar", name)]
    assert len(launchers) == 1, "Expected one Equinox launcher"
    launcher = launchers[0].removeprefix("./")
    configs = sorted(name for name in names if name.endswith("/config.ini"))
    assert all(any(name.endswith(f"{folder}/config.ini") for name in names) for folder in ["config_linux", "config_mac", "config_win"])
pin = dict(id="jdtls", platform="any", version=VERSION, url=BASE+NAME, sha256=checksum.lower(),
    size=len(content), archive="tar-gz", prefix="", entry=launcher, license="EPL-2.0; bundled dependency licenses retained")
pathlib.Path("evidence").mkdir(exist_ok=True)
pathlib.Path("evidence/jdtls-package.json").write_text(json.dumps(pin, indent=2)+"\n")
pathlib.Path("evidence/jdtls-layout.json").write_text(json.dumps({"launcher":launcher,"configs":configs,"files":len(names)},indent=2)+"\n")
print(json.dumps({"verified":True,"version":VERSION,"size":len(content),"sha256":checksum.lower(),"entry":launcher}))
