# 墨题 InkLeet
面向 leetcode.cn 的本地优先跨平台刷题本。暖白、克制，只围绕找题、代码、结果与笔记。

**开发预览，尚未完成真实账号在线判题和全部平台验收。** 逐项测试证据见 [STATUS.md](STATUS.md)。
当前源码版本为 **0.1.2**。已发布版本及其安装包以 [Releases](https://github.com/jacek4yang/inkleet/releases) 为准；源码功能、自动化测试和安装包验收是不同层次。已发布的 v0.1.1 基线来自 `fbacb204`，见 [发布记录](releases/v0.1.1.md)。

## 下载与安装
- Preview package targets: macOS Intel x86_64 DMG, Windows x64 setup EXE / MSI, and Linux x86_64 tar.gz.
- 从 [Releases](https://github.com/jacek4yang/inkleet/releases) 下载公开版本；每个版本的 `RELEASE_MANIFEST.json` 和 `SHA256SUMS` 记录精确源码、构建、验收和附件校验值。Actions 测试包不是公开 Release。
- Windows 的 EXE / MSI 任选一种；未安装 WebView2 时可能需要联网获取运行时。CI 要求无人值守 MSI 安装、卸载、升级与测试种子数据逐字节保留检查；**Windows 实机界面及升级后应用运行/迁移仍未完成验收**。见 [Windows 验收](docs/WINDOWS_ACCEPTANCE.md)，安装器检查不代表应用运行通过。
- Linux tar.gz 解压后运行 `./start.sh`。面向 Ubuntu 24.04 / Mint 22 系列，需要 WebKitGTK 4.1 / GTK3；不是全静态或通用 Linux 包。
- macOS 包仅面向 Intel。Ventura 的完整实际使用仍待验收；构建元数据里的最低系统版本不是兼容性保证。
- Windows / macOS 包未签名，macOS 未公证；不要为安装而关闭系统安全保护。
- 升级前备份应用数据、代码和笔记，关闭旧版本。不要让多个版本同时写同一份数据。

## 使用手册
操作说明、快捷键、环境与下载规则见 [使用手册](docs/USER_MANUAL.md)。

## 当前工作台
- Python、Rust、Go、C、C++、Java 的 CodeMirror 编辑器，Intel One Mono，独立草稿、撤销、光标和滚动状态。
- 中国站公开题库、中文题面、官方模板、最近题目缓存和离线恢复。
- 粘贴题面、题解、提交页或竞赛题链接直达；严格校验域名与路径，不跟随第三方分享地址，不发送分享令牌。
- 各语言源码及每题 notes.md 原子保存，重启恢复；冲突时保留草稿，明确对比后选择版本。
- Markdown Worker 预览与白名单净化，常见标题、列表、代码块、表格；链接只显示文字，图片和公式扩展尚未接入。
- 六语言私有工具下载、官方固定来源/哈希校验、断点续传、取消、受限解压与原子激活；不改系统 PATH。关闭环境窗口后后台队列继续。
- Pyright、rust-analyzer、gopls、clangd、JDT LS：成员补全、悬停、参数提示、诊断、F12 / Ctrl+单击及只读标准库视图。Python .pyi 明确标为类型声明。参数片段、延迟导入和动作支持按语言/平台限定，见 [编辑能力矩阵](docs/EDITING_SUPPORT.md)。
- 元数据驱动的虚拟 Solution / ListNode / TreeNode；辅助代码不混入用户保存和在线提交源码。
- F2 语义重命名，当前题目内的修改是一次可撤销事务；拒绝过时、跨文件或触及辅助代码的编辑。
- Ctrl+. / Command+. 代码操作先预览再应用；只接受受支持语言服务的当前源码编辑，不执行服务器命令或任意文件操作。
- 解答可确认归档并恢复，保留源码、未保存草稿、恢复副本与原标识；不提供永久删除。

## 新增编辑和笔记能力
The features below are present in current source; passed checks and remaining acceptance gaps are recorded in STATUS.md.
- Shift+F12 本题语义引用列表（含声明），点击跳回原始源码；不读取任意外部文件。
- 冲突恢复副本列表、两版本预览和显式恢复。恢复前再保留当前两份内容；磁盘再次变化则拒绝覆盖。这不是完整编辑历史。
- 笔记可请求 Typora 或系统默认编辑器打开；返回窗口或手动刷新时检查文件。干净草稿可更新，脏草稿进入冲突处理。实际 Typora 启动仍待验收。
- 暂停栈帧表达式求值已接入；显式执行一次，不自动重复，3 秒超时停止调试。Java 当前不支持此求值入口。不能据此宣称与成熟 IDE 调试器等价。
- Vim、搜索式设置、语言格式化覆盖、Tab 显示宽度；显式保存、恢复草稿和配置冲突保护。
- F2 重命名准备与可选预览；Rust 集合逻辑视图与显式原始视图。

Rust 调试变量支持有界分页与已识别集合的逻辑显示；未知形状保留原始查看方式。Map 的三平台实际适配器数据与 Linux 原生界面有独立证据，不等于所有 Rust 类型或所有平台 GUI 已完成验收。见 [可视化范围](docs/RUST_VARIABLE_VISUALIZATION.md)。

## 本地运行与调试
桌面点击「开发环境」安装所选语言工具，再用「本地」面板。
六语言普通函数题使用独立的元数据驱动，支持常见标量、多参数、数组、二维数组和链表/树。
Rust/Python 增加受限设计类操作序列与 NestedInteger。普通零参数调用使用 `[]`；六语言驱动均已接入，本次新增实际探针覆盖 Rust/Python，不外推其他语言验收。其他特殊接口及不支持的语言组合会明确拒绝。支持类型、输入约定与边界见 [本地运行契约](docs/LOCAL_TEST_POLICIES.md)。本地结果不等于力扣通过结论。
- F9 / 行号栏断点；F5 开始/继续；F10 跳过；F11 进入；Shift+F11 跳出；Shift+F5 停止。
- 调试栈、变量、原始源码停靠行；运行中可显式「应用断点」。
- 普通执行 10 秒、标准输出/错误 64 KiB，结构化结果文件最多 1 MiB；编译预算按语言区分。调试连续执行 30 秒、会话最长 30 分钟。
- Java 堆上限 256 MiB；其他语言尚无硬内存上限。
- 退出时清理应用拥有的工具进程组 / Windows Job，不按名称扫描其他程序。
**仅运行信任的代码：环境隔离不是安全沙箱。**

Linux 原生六语言 GUI 已验证；四种桌面目标的协议与编译探针另行记录，不能替代 Windows/macOS 真机 GUI。
Android 和 macOS ARM 不属于当前发布附件范围。历史探针不能替代当前版本的平台验收。

## 登录与在线判题
原生二维码登录与用户主动选择的官方网页登录均已实现。可选的记住登录使用系统凭据存储；密码和会话 cookie 不返回编辑器 JavaScript。
真实账号、跨重启会话及平台存储需要分别验收；测试夹具或合成凭据探针不代表真实账号通过。存储不可用或清理状态不确定时安全失败，不使用明文兜底。见 [登录范围](docs/NATIVE_LOGIN.md)。
Android 安全登录隔离仍在适配，不使用明文会话兜底。
在线运行和提交绑定不可变的题目/账号/语言/代码快照，正式提交须确认。
发送状态未知时不自动重试，已知请求编号可继续查询。
浏览器登录成功、公开题库成功及模拟 IPC 均不代表客户端账号判题通过。

## 用链接打开题目
顶栏「链接打开」支持 leetcode.cn 和旧 leetcode-cn.com 的题目相关链接。
国际站、第三方短链及不含题目标识的全局提交详情暂不支持。
重复打开不覆盖草稿；有缓存时网络失败可离线打开；没有缓存则报错而不切换当前题目。
尚未注册系统 URL Scheme / App Links。

## 开发
需要 Node.js 24、Rust stable 和对应平台 Tauri 2 构建依赖。
这些是源码开发依赖，不要求最终用户先安装全套语言开发环境。

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run tauri -- icon icon.svg
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- dev
```

浏览器 `npm run dev` 预览仅保留内存草稿，刷新前务必导出。
原生文件位于系统应用数据目录下的 `top.jacek.inkleet/notebook/`。个人代码、笔记和凭据不上传到本仓库。

## 测试与构建
工作流见 [.github/workflows](.github/workflows)。类型/单元/Chromium、Linux 原生 GUI、四平台语言协议与驱动分别记录。
手动 CI 的 all / desktop / linux / android / native-test 用于里程碑构建。
后续 Linux 桌面构建同时生成 DEB 与 tar.gz，并分别测试安装后与解压后的程序。
Android 模拟器测试使用独立 x86_64 APK，不修改宿主安全权限。
安装包以具体提交、校验值和实际测试报告为准；构建成功不等于日常使用验收。
