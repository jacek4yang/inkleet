#!/usr/bin/env bash
set -euo pipefail
# Package a verified DEB without rebuilding or executing the application.
deb="$(realpath "${1:?DEB path required}")"
commit="${2:?source commit required}"
out="$(mkdir -p "${3:?output directory required}"; realpath "$3")"
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid source commit" >&2; exit 1; }
test "$(dpkg-deb -f "$deb" Architecture)" = amd64
test "$(dpkg-deb -f "$deb" Package)" = inkleet
version="$(dpkg-deb -f "$deb" Version)"
[[ "$version" =~ ^[0-9A-Za-z.+-]+$ ]]
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
dpkg-deb -x "$deb" "$work/extracted"
test -x "$work/extracted/usr/bin/inkleet"
short="$(printf '%s' "$commit" | cut -c1-7)"
name="InkLeet-$version-preview-$short-linux-x86_64"
mkdir -p "$work/$name"
cp "$work/extracted/usr/bin/inkleet" "$work/$name/inkleet"
cat > "$work/$name/start.sh" <<'SH'
#!/usr/bin/env sh
set -eu
base="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$base/inkleet" "$@"
SH
chmod 755 "$work/$name/start.sh"
cat > "$work/$name/README.txt" <<'DOC'
墨题 InkLeet · Linux x86_64 开发测试版

使用：
1. 解压本 tar.gz。
2. 在解压后的目录打开终端，执行 ./start.sh（或 ./inkleet）。
3. 在开发环境中按需下载语言工具。工具保存在应用自己的目录，不修改系统 PATH。

这是免安装压缩包，不是自带全部系统库的静态程序。
基于 Ubuntu 24.04 构建；适合 Ubuntu 24.04 / Linux Mint 22 系列的 x86_64 桌面。
需要 WebKitGTK 4.1、GTK3 及相关系统库。若启动提示缺少动态库：
  ldd ./inkleet | grep 'not found'
Ubuntu / Mint 可先安装：
  sudo apt-get install libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2
完整 DEB 依赖清单见 DEPENDENCIES.txt。其他发行版请安装对应系统包；
不能保证在更旧 glibc 系统、ARM Linux 或无图形桌面上运行。

开发预览，桌面包未签名：
- 六语言工具下载、代码补全、标准库查看、本地普通函数运行与断点调试已通过 Linux 原生检查。
- 公开中国站搜索、题目链接、离线缓存与本机笔记已测试。
- 真实账号登录与在线运行/提交尚未完整验收。
- 工具目录隔离不是安全沙箱；仅运行你信任的代码。
- 此检查点没有后来添加的 Typora 外部编辑、引用查找和恢复历史浏览。

程序数据与压缩包分离，位于系统应用数据目录（通常为 ~/.local/share/top.jacek.inkleet）。
删除解压目录不会自动删除笔记、源码和下载的语言工具。
升级前请备份应用数据，不要同时运行多个版本写同一份笔记。

仓库：https://github.com/jacek4yang/inkleet
已验证构建：https://github.com/jacek4yang/inkleet/actions/runs/38489326380
DOC
printf '%s\n' "$commit" > "$work/$name/SOURCE_COMMIT.txt"
dpkg-deb -f "$deb" Depends > "$work/$name/DEPENDENCIES.txt"
sha256sum "$deb" | awk '{print $1}' > "$work/$name/SOURCE_DEB_SHA256.txt"
cp LICENSE "$work/$name/LICENSE"
if test -d public/fonts; then
  mkdir -p "$work/$name/font-licenses"
  find public/fonts -type f \( -iname '*license*' -o -iname '*OFL*' \) -exec cp {} "$work/$name/font-licenses/" \;
fi
tar -C "$work" -czf "$out/$name.tar.gz" "$name"
(cd "$out" && sha256sum "$name.tar.gz" > "$name.sha256")
cp "$work/$name/README.txt" "$out/README-linux.txt"
tar -tzf "$out/$name.tar.gz"
