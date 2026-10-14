#!/usr/bin/env bash
set -euo pipefail
# Package a verified DEB without rebuilding or executing the application.
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
- 本包安装与解压启动、命名解答持久化、笔记冲突和恢复操作已通过 Linux 原生检查。
- 语言工具链、LSP 与调试器的验收范围按对应提交的测试记录分别列出，不能由安装测试代替。
- 公开中国站功能与登录后的在线评测分别验证，不把离线样例作为在线验收。
- 真实账号登录与在线运行/提交尚未完整验收。
- 工具目录隔离不是安全沙箱；仅运行你信任的代码。
- 本包包含语义高亮、命令面板、F2 保护、缩进引导线和 Rust 自动导入补全。
- 新增显式保存时格式化、未保存草稿恢复、独立断点与箭头槽、克制的 Codicons 图标。
- 新增可编辑命名测试用例、可视化返回值，以及可选 Vim 和 :w 保存。
- Ctrl+S 才格式化和保存；编辑停顿不会自动格式化。升级前备份应用数据。
- 独立分支的 prepareRename/重命名预览及集合调试改进未包含在本包中。
- 集成源码检查点 01103ebaac30503968d1ae743077961de30c34b3；验收结果见 Draft PR #28。
- 具体能力以 SOURCE_COMMIT.txt 所列提交及对应 Draft PR #28 的测试记录为准。

程序数据与压缩包分离，位于系统应用数据目录（通常为 ~/.local/share/top.jacek.inkleet）。
删除解压目录不会自动删除笔记、源码和下载的语言工具。
升级前请备份应用数据，不要同时运行多个版本写同一份笔记。

仓库：https://github.com/jacek4yang/inkleet
测试记录与对应构建请查看仓库 Actions 和 STATUS.md。
DOC
printf '%s\n' "$commit" > "$work/$name/SOURCE_COMMIT.txt"
if test "$commit" = a62a3db00a740f83425476b4daeab1dbe75abc21; then
  printf '\n本包为已验证的 a62a3db 检查点，不包含后来的 Typora、引用查找和恢复历史浏览。\nhttps://github.com/jacek4yang/inkleet/actions/runs/38489326380\n' >> "$work/$name/README.txt"
fi
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
