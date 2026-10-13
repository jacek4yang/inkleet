# 墨题 InkLeet
面向 leetcode.cn 的本地优先跨平台刷题本。暖白、克制，只围绕找题、代码、结果与笔记。

**开发中，不是完整可用的力扣客户端。** 功能和平台证据见 [STATUS.md](STATUS.md)。

当前工作分支：`feat/first-workbench`，审阅入口：[PR #1](https://github.com/jacek4yang/inkleet/pull/1)。

## 已有能力
- 六语言 CodeMirror 编辑，独立草稿与撤销历史；内置 Intel One Mono。
- 中国站真实公开题库、中文题面、六语言官方模板与最近题目离线缓存。
- 粘贴中国站题面、题解、提交记录或竞赛题目链接直接打开题目；只提取 slug，不访问任意分享 URL。
- 每题一份真实 Markdown 文件和各语言源码；原生自动保存、重启恢复和基础冲突拒绝覆盖。
- 离线 Markdown 预览：解析在可终止 Worker 中运行，输出白名单净化，保留编辑撤销与完整原文导出。
- 桌面三栏、窄屏单区、专注模式；浏览器可导出源码和 Markdown。
- Linux 原生存储端到端测试；前端交互、类型、领域规则与万行代码响应测试。
- Windows、Linux、macOS Intel/ARM、Android ARM64 的开发构建路径。

## 登录接入状态
桌面已加入独立隐私窗口的官方登录与原生会话校验原型，会话不返回编辑器 JavaScript。
当前仅支持本次运行内存会话，尚未完成实际账号端到端验收或重启恢复。
Android 安全登录隔离仍在适配，不开放不安全的明文兜底。
在线运行、正式提交与结果入口已接入，但真实客户端账号端到端链路尚未验收。
每次请求绑定不可变快照；正式提交须确认；发送状态未知时不自动重试，重启后仍保留保护。
本地 Runner、LSP 和调试尚未实现；不要把自编演示题、IPC fixture 或公开题库测试当成真实账号评测通过。

## 用链接打开题目
点击顶栏「链接打开」，粘贴单个中国站题目相关链接，再点「打开题目」。
支持 leetcode.cn 及旧中国站 leetcode-cn.com 链接；国际站、第三方短链和不含题目标识的全局提交详情地址暂不支持。
查询参数和片段会被丢弃，不会发送分享令牌。非法域名、用户信息、异常端口、编码分隔符与点路径会被拒绝。
网络请求失败时，有公开缓存的题目会显式以离线缓存打开；没有缓存则报错，不切换当前题目。
重复打开保留已有各语言草稿和笔记，关闭或更换链接后忽略旧请求。
这是应用内粘贴入口，尚未注册系统级 URL Scheme/App Links。

## Markdown 预览
在「笔记」中点击「预览笔记」，再通过「返回编辑」继续书写。
支持常见标题、列表、代码块、强调和表格；链接仅显示文字，不加载图片、脚本、表单、嵌入页面或公式扩展。
复杂或超限文档停止预览，不截断原文；导出的 notes.md 保持原始内容。

## 开发
开发者需要 Node.js 24、当前 Rust stable 和平台的 Tauri 2 构建依赖。
这些是开发依赖，不是未来安装包在线刷题功能的用户前置要求。

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run tauri -- icon icon.svg
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- dev
```

浏览器预览：`npm run dev`。浏览器预览草稿只在内存中，刷新前务必导出。
原生内容位于系统应用数据目录下的 `top.jacek.inkleet/notebook/`；每题独立目录。
当前不上传个人代码和笔记到本仓库。

## 测试与构建
可审查的工作流在 [.github/workflows](.github/workflows)：
- CI：类型检查、领域测试、真实 Chromium 前端测试和截图。
- Native Linux：真实 Tauri/WebKitGTK 的保存、进程重启恢复和外部冲突测试。
- 手动 CI 的 all / desktop / linux / android / native-test 参数用于里程碑构建。

锁文件必须提交，安装包以具体提交和实际测试报告为准。
真实网络探测与离线测试分开记录，网络失败不伪装成接口已验证。
Android 当前产物为 Debug APK，尚无正式固定签名和真机升级验收。
桌面安装包未做商业签名/公证；不得为安装而全局关闭系统安全机制。

## 边界
无 AI 解题、插件商店、通用终端和强制云同步。
浏览器截图不代表原生验证，构建成功不代表安装和日常使用验收通过。
