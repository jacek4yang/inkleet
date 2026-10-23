#!/usr/bin/env bash
set -euo pipefail
# Package a DEB without rebuilding or executing the application.
# The calling workflow must independently verify the extracted launcher before delivery.
deb="$(realpath "${1:?DEB path required}")"
commit="${2:?source commit required}"
out="$(mkdir -p "${3:?output directory required}"; realpath "$3")"
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid source commit" >&2; exit 1; }
test "$(dpkg-deb -f "$deb" Architecture)" = amd64
test "$(dpkg-deb -f "$deb" Package)" = ink-leet
version="$(dpkg-deb -f "$deb" Version)"
[[ "$version" =~ ^[0-9A-Za-z.+-]+$ ]]
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
dpkg-deb -x "$deb" "$work/extracted"
test -x "$work/extracted/usr/bin/inkleet"
short="$(printf '%s' "$commit" | cut -c1-12)"
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
墨题 InkLeet · Linux x86_64 开发预览

使用：
1. 解压本 tar.gz。
2. 在解压后的目录打开终端，执行 ./start.sh（或 ./inkleet）。
3. 在应用内按需下载语言工具；工具保存在应用目录，不修改系统 PATH。

这是免安装压缩包，不包含全部系统动态库。
构建基线为 Ubuntu 24.04 x86_64；其他发行版、较旧 glibc、ARM Linux
或无图形桌面环境尚未验收。需要 WebKitGTK 4.1、GTK3 等系统库。
Ubuntu 24.04 可使用发行版软件源安装运行库，例如：
  sudo apt-get install libwebkit2gtk-4.1-0 libgtk-3-0t64 libayatana-appindicator3-1 librsvg2-2
完整的构建包依赖见 DEPENDENCIES.txt；该文件保留本次 DEB 的依赖版本约束。
若启动提示缺少动态库，可查看：
  ldd ./inkleet
请使用发行版软件源安装对应依赖，不从不明网站下载替代动态库。
下载语言工具和访问在线服务需要网络；运行离线笔记本不等于在线功能已验收。

本包是 release/default-features 构建，没有启用诊断用 snippet features。
源码以 SOURCE_COMMIT.txt 为准；本次 CI 的结果以旁边 BUILD_INFO.json
指向的 Actions 记录及同次验证附件为准。只在构建和对应测试成功后交付。
安装/解压启动检查不能代替全部语言工具链、LSP、调试器或在线功能验收。
真实账号登录及在线运行/提交不包含在本包的通用验收承诺中。
工具目录隔离不是安全沙箱；仅运行你信任的代码。
这是未签名开发预览，SHA-256 只能核对文件完整性，不能认证发布者。

程序数据与压缩包分离，位于系统应用数据目录（通常为 ~/.local/share/top.jacek.inkleet）。
删除解压目录不会自动删除笔记、源码和下载的语言工具。
升级前请备份应用数据，不要同时运行多个版本写同一份笔记。

仓库：https://github.com/jacek4yang/inkleet
DOC
printf '%s\n' "$commit" > "$work/$name/SOURCE_COMMIT.txt"
dpkg-deb -f "$deb" Depends > "$work/$name/DEPENDENCIES.txt"
sha256sum "$deb" | awk '{print $1}' > "$work/$name/SOURCE_DEB_SHA256.txt"
if test -f LICENSE; then cp LICENSE "$work/$name/LICENSE"; fi
if test -d public/licenses; then cp -R public/licenses "$work/$name/licenses"; fi
if test -d public/fonts; then
  mkdir -p "$work/$name/font-licenses"
  find public/fonts -type f \( -iname '*license*' -o -iname '*OFL*' \) -exec cp {} "$work/$name/font-licenses/" \;
fi
# Preserve dependency notices, including the Vim adapter/core MIT licenses.
if test -d node_modules; then
  while IFS= read -r -d '' license; do
    relative="${license#node_modules/}"
    target="$work/$name/dependency-licenses/$relative"
    mkdir -p "$(dirname "$target")"
    cp "$license" "$target"
  done < <(find node_modules -type f \( -iname 'license*' -o -iname 'copying*' -o -iname 'notice*' \) -print0)
fi
tar -C "$work" -czf "$out/$name.tar.gz" "$name"
(cd "$out" && sha256sum "$name.tar.gz" > "$name.sha256")
cp "$work/$name/README.txt" "$out/README-linux.txt"
tar -tzf "$out/$name.tar.gz"

