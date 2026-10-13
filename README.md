# 墨题 InkLeet
面向 leetcode.cn 的本地优先跨平台刷题本。暖白、克制，只围绕找题、代码、结果与笔记。

**开发中，不是完整可用的力扣客户端。** 功能和平台证据见 [STATUS.md](STATUS.md)。

当前工作分支：`feat/first-workbench`，审阅入口：[PR #1](https://github.com/jacek4yang/inkleet/pull/1)。

## 已有能力
- 六语言 CodeMirror 编辑，独立草稿与撤销历史。
- 每题一份真实 Markdown 文件和各语言源码；原生自动保存、重启恢复和基础冲突拒绝覆盖。
- 桌面三栏、窄屏单区、专注模式；浏览器可导出源码和 Markdown。
- Linux 原生存储端到端测试；前端交互、类型、领域规则与万行代码响应测试。
- Windows、Linux、macOS Intel/ARM、Android ARM64 的开发构建路径。

## 登录接入状态
桌面已加入独立隐私窗口的官方登录与原生会话校验原型，会话不返回编辑器 JavaScript。
当前仅支持本次运行内存会话，尚未完成实际账号端到端验收或重启恢复。
Android 安全登录隔离仍在适配，不开放不安全的明文兜底。
运行、提交和本地调试尚未开放；不要把自编演示题当成真实力扣数据。

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
- 手动 CI 的 all / desktop / android / native-test 参数用于里程碑构建。

锁文件必须提交，安装包以具体提交和实际测试报告为准。
真实网络探测与离线测试分开记录，网络失败不伪装成接口已验证。
Android 当前产物为 Debug APK，尚无正式固定签名和真机升级验收。
桌面安装包未做商业签名/公证；不得为安装而全局关闭系统安全机制。

## 边界
无 AI 解题、插件商店、通用终端和强制云同步。
浏览器截图不代表原生验证，构建成功不代表安装和日常使用验收通过。
