"""Maintainer-only gopls source pin resolver; never executes downloaded code."""
import hashlib,io,json,pathlib,urllib.parse,urllib.request,zipfile
VERSION="v0.23.0"
MODULE="golang.org/x/tools/gopls"
URL=f"https://proxy.golang.org/{MODULE}/@v/{VERSION}.zip"
EXPECTED_MOD = "module golang.org/x/tools/gopls\n\ngo 1.26.0\n\nrequire (\n\tgithub.com/fatih/gomodifytags v1.17.1-0.20250423142747-f3939df9aa3c\n\tgithub.com/fsnotify/fsnotify v1.9.0\n\tgithub.com/google/go-cmp v0.7.0\n\tgithub.com/google/jsonschema-go v0.4.3\n\tgithub.com/jba/templatecheck v0.7.1\n\tgithub.com/modelcontextprotocol/go-sdk v1.6.0\n\tgolang.org/x/mod v0.37.0\n\tgolang.org/x/net v0.56.0\n\tgolang.org/x/sync v0.21.0\n\tgolang.org/x/telemetry v0.0.0-20260625142307-59b4966ccb57\n\tgolang.org/x/text v0.38.0\n\tgolang.org/x/tools v0.47.1-0.20260707181000-a299dadba899\n\tgolang.org/x/vuln v1.4.0\n\tgopkg.in/yaml.v3 v3.0.1\n\thonnef.co/go/tools v0.8.0-rc.1\n\tmvdan.cc/gofumpt v0.10.0\n\tmvdan.cc/xurls/v2 v2.6.0\n)\n\nrequire (\n\tgithub.com/BurntSushi/toml v1.6.0 // indirect\n\tgithub.com/fatih/camelcase v1.0.0 // indirect\n\tgithub.com/fatih/structtag v1.2.0 // indirect\n\tgithub.com/google/safehtml v0.1.0 // indirect\n\tgithub.com/segmentio/asm v1.2.1 // indirect\n\tgithub.com/segmentio/encoding v0.5.4 // indirect\n\tgithub.com/yosida95/uritemplate/v3 v3.0.2 // indirect\n\tgolang.org/x/exp/typeparams v0.0.0-20260611194520-c48552f49976 // indirect\n\tgolang.org/x/oauth2 v0.36.0 // indirect\n\tgolang.org/x/sys v0.46.0 // indirect\n\tgopkg.in/check.v1 v1.0.0-20190902080502-41f04d3bba15 // indirect\n)\n"
with urllib.request.urlopen(URL,timeout=120) as response:
    target=urllib.parse.urlsplit(response.url)
    assert target.scheme=="https" and target.hostname in {"proxy.golang.org","storage.googleapis.com"}
    content=response.read(32*1024*1024+1)
    assert len(content)<=32*1024*1024
prefix=MODULE+"@"+VERSION
with zipfile.ZipFile(io.BytesIO(content)) as archive:
    assert archive.read(prefix+"/go.mod").decode()==EXPECTED_MOD, "Source module does not match reviewed upstream tag"
    assert archive.read(prefix+"/go.sum"), "Source must contain dependency checksums"
digest=hashlib.sha256(content).hexdigest()
pins=[]
for platform in ["linux-x64","windows-x64","macos-x64","macos-arm64"]:
    pins.append(dict(id="gopls",platform=platform,version=VERSION[1:],url=URL,sha256=digest,size=len(content),archive="zip",prefix=prefix,entry="bin/gopls.exe" if platform=="windows-x64" else "bin/gopls",license="BSD-3-Clause; source and dependency licenses retained"))
pathlib.Path("evidence").mkdir(exist_ok=True)
pathlib.Path("evidence/gopls-packages.json").write_text(json.dumps(pins,indent=2)+"\n")
print(json.dumps({"version":VERSION,"sha256":digest,"size":len(content),"goModMatchesReviewedTag":True,"requiresPrivateGoBuild":True}))
