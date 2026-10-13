# 墨题开发状态
更新时间：2026-10-13。仍为开发预览，尚未满足日常使用和正式发布验收。

## 远端入口
- 仓库：https://github.com/jacek4yang/inkleet
- 开发分支：feat/first-workbench
- Draft PR：https://github.com/jacek4yang/inkleet/pull/1
- 主分支仍为最初检查点，尚未合并或发布正式 Release。

## 最新验收（2026-10-13 22:30 UTC）
以下更新优先于后文的历史检查点。当前仍为开发分支，不是完整 IDE 或稳定版本。
- 六种桌面语言服务已接入：Pyright、JDT LS、gopls、rust-analyzer、clangd（C / C++ 独立文档模式）。虚拟 package / 头文件不改动保存或提交的解答；本文件定义跳转也映射回原始行号。
- Java 的真实 Linux 安装、成员补全和 JDK 源码浏览通过；Linux / Mac Intel / ARM 的返回源码与 JDK src.zip 比较通过。Windows Java 仍未开放：上游 JDK 原生库加载在不兼容系统代码页的路径上失败，短路径别名也未解决。
- Go LSP 四平台协议通过（包括 Windows 私有 TEMP / 配置目录修复）：
  https://github.com/jacek4yang/inkleet/actions/runs/38474190971
- Go 类型驱动四平台全部通过，覆盖数组、链表、树、字符、大整数、溢出、panic 和循环结构：
  https://github.com/jacek4yang/inkleet/actions/runs/38474520258
- Go 本地运行已在真实 Linux GUI 得到结果 10；同一次验证还通过 Java / Go 源码查看和 Python 本地运行 / 调试，但之后 Rust 冷启动补全失败，因此整次工作流不能标成通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38475942120
- Rust 曾在真实 Linux GUI 通过安装、成员补全和标准库源码查看；后续冷启动再次出现服务已连接但首次返回空补全，4446884 加入仅针对未改变请求上下文的有界重试，待最新原生回归。
- Go Delve 真实 DAP 四平台通过。后续带生成驱动的协议回归，也确认原始解答第 3 行断点和单步后 total 从 1 变 3：
  https://github.com/jacek4yang/inkleet/actions/runs/38477220783
  Go 调试 UI、可取消编译 / 启动已接入，原生 GUI 正在验收，不能将协议通过当成 UI 通过。
- C/C++ 的私有标准库 LSP 和 CodeLLDB 断点 / 栈 / 变量 / 单步四平台通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38467212784
  C/C++ GUI 语义补全仍在回归；Runner 和调试 UI 尚未接入。
- Windows Rust 的完整私有链接组件已补齐。使用编译器自带 MSVC-host LLD 驱动 GNU-target 链接，中文及空格路径下的线程、panic unwind 和运行结果已通过独立测试：
  https://github.com/jacek4yang/inkleet/actions/runs/38477381027
  全工具链矩阵仍在回归，Rust 本地题目驱动和调试 UI 未完成。
- Python 的 Windows DAP、其他桌面平台协议已通过。原生测试中偶有 WebKit WebDriver 连接重置；截图显示应用仍在运行，尚不能据此归因于应用崩溃。测试只对可验证、可重放的本地字段替换 / 绝对定位查询 / 关闭窗口做一次恢复，并记录证据；不会重放在线运行、提交或调试单步。
- 最新前端模拟回归通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38477771390
- 已构建安装包仍停留在历史 9daa959，未包含本节全部功能。需在功能整合和回归完成后重新打包。

## 已实现并验证
- CodeMirror 6：Python 3 / Rust / Go / C / C++ / Java 与 Markdown；独立草稿、撤销、光标与滚动状态。
- 源码及 notes.md 原生原子保存；进程重启恢复；检测外部版本冲突并保留两份正文。
- 修复切换语言重置共享笔记、读取完成前挂载模板导致恢复内容未显示的问题；源文件未丢失。
- 中国站真实公开题库搜索、分页、中文题面、六语言官方模板。题面以 DOMPurify 白名单净化。
- 最近 50 题、总计最多 2 MiB 的公开题面缓存。真实 GUI 验证断网重启后打开题目和恢复源码，网络不可用时明确报错。
- 内置官方未修改 Intel One Mono Regular / Italic / Bold / Bold Italic；OFL 许可和作者声明随包提供，并可在界面查看。
- 真实 Linux GUI 与离线恢复：https://github.com/jacek4yang/inkleet/actions/runs/38433838920 （a2267d5）。
- 同一提交五目标安装包构建全通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38434539780 （a2267d5）。
  Windows x64 NSIS、Linux x64 DEB、macOS Intel/ARM DMG、Android ARM64 Debug APK。
  这些安装包尚不含后来接入的在线评测入口。
  注意：该次旧 Linux DEB 的中文 Package 字段无效，不能安装，勿使用；其余目标也仅为构建通过。
- Linux DEB 包名问题已修复为 ink-leet，界面仍显示“墨题 InkLeet”。
  https://github.com/jacek4yang/inkleet/actions/runs/38439268539 （b225c66）。
  已实际 apt 安装 /usr/bin/inkleet，并从安装位置运行 GUI 保存、重启恢复、外部冲突测试。
  18 项 Rust 测试通过；1 项实时公开接口测试在该安装工作流中未运行。
  CI Ubuntu 24.04 已预装开发依赖，不等于干净发行版兼容性验收。
- 万行 438,889 字符前端受控输入测试，32 样本 P95 26.8ms：
  https://github.com/jacek4yang/inkleet/actions/runs/38427518348 （a411b9c）。
  GitHub Runner / Chromium / AMD EPYC 9V74 / 4 CPU。不是原生 IME 或手机真机结论。

## 链接直达与笔记预览（ab5abd3）
- 顶栏「链接打开」支持中国站题面、题解、该题提交记录与竞赛题目地址；兼容旧中国站域名。
- 严格域名/协议/端口/用户信息/编码/路径检查，仅将题目标识交给固定中国站接口，丢弃查询参数和片段。
- 重复点击保护，编辑输入或关闭后忽略旧响应；重复打开题目不覆盖草稿。
- 无网络时尝试已验证格式的公开题目缓存，并明确标注离线；无缓存保留当前工作区并报错。
- Markdown 预览使用 marked 18.1.1 Worker 和 DOMPurify 白名单；限制输入、输出及耗时，不改动原文。
- 前端测试通过（包括链接竞态、恶意 Markdown、完整导出和撤销保持）：
  https://github.com/jacek4yang/inkleet/actions/runs/38442374753
- 真实 Linux GUI 与中国站公开协议、链接打开、重复打开草稿保持、断网链接缓存回退通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38442365157
  18 项 Rust 单元测试通过；单独实时公开协议探测退出码 0；不含私人账号评测。
- 全平台最新开发包：
  https://github.com/jacek4yang/inkleet/actions/runs/38442530818
  Windows x64、Linux x64、macOS Intel/ARM、Android ARM64 五目标均构建成功。
  Linux 包已实际安装并从安装位置通过存储及笔记预览 GUI 测试；其余平台尚未实际安装/真机验收。
- Android 仍为 ARM64 Debug APK，体积约 160 MiB（含调试符号），尚未做真机验证和正式体积优化。

## 独立工具链与 Python IDE（2026-10-13）
- 私有目录、编译内置固定来源及 SHA-256、精确文件长度、分段续传、取消、跨进程安装锁、暂存解压后原子激活。
- 安全压缩包路径、解压大小限制、文件链接物化；不向系统 PATH / Python / Node 环境写入。
- Python 3.14.8、Node 24.21.0、Pyright 1.1.414 四平台真实 LSP 协议测试通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38448622141 （bc428bd）。
- Linux 真实 GUI 自动安装、补全应用、F12 标准库声明窗口、类型诊断和语言切换草稿保持通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38451257790 （de63eb1）。
- 本地 Python 类型驱动、超时、取消、输出限制、正常退出后的子进程清理；debugpy 真实断点、栈、变量、单步及继续已在 Linux 通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38454448001/job/115494092727 （e422f0d）。
  同一 Linux job 还证明 Rust 1.99.0、Cargo、rust-analyzer、私有 Zig 下的 Rust / C / C++ 编译运行，不使用系统 PATH。
  Mac ARM 的 Python 运行 / 调试协议也通过，但同 job 后续编译失败；不能将整个平台记为通过。
- 新增本地运行面板、F9 / gutter 断点、DAP 控制、调用栈与变量面板；前端模拟 IPC 交互通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38455636400 （fd8b8ae）。
  随后的真实 Linux GUI 通过自动环境安装、Python 本地计算结果、F9 断点命中、调用栈面板和停止：
  https://github.com/jacek4yang/inkleet/actions/runs/38455628161 （fd8b8ae）。
  原生 GUI 的变量刷新与单步变化还需更深入验收；协议测试另有覆盖。
- 修正原生补全 fixture：等待 CodeMirror 的短暂误触保护时间后点击；最新原生回归已通过。
- Windows DAP launch、Mac 私有编译尚有失败；其余语言 LSP / Runner / DAP 尚未完成。
- 本地驱动与个人源文件隔离，当前支持普通函数常见类型；设计类和特殊接口题明确不支持。
- 运行是普通用户进程，不是安全沙箱；尚无硬内存限制。调试在暂停时不会触发普通运行超时。
- 最新五目标安装包已在 9daa959 构建通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38459086881
  Windows x64 NSIS、Linux x64 DEB、macOS Intel/ARM DMG、Android ARM64 Debug APK。
  Linux DEB 已实际安装并完成安装位置 GUI 回归；其他平台仅构建通过，不能等同于真实调试或登录验收。
- 9daa959 的专门 Linux 原生 IDE 回归通过：Python 本地计算、F9 断点、源码暂停行、真实调用栈和变量列表、停止。
  https://github.com/jacek4yang/inkleet/actions/runs/38457840681
- 5512393 新增 Go / JDK / clangd / Delve / CodeLLDB 固定官方分发包。
  https://github.com/jacek4yang/inkleet/actions/runs/38459229403
  Mac Intel 和 ARM 的 Go / Java 私有编译运行、标准库文件检查通过；clangd / Delve / CodeLLDB 仅启动检查通过，尚非完整协议或 GUI 集成。
  Linux JDK 原生库初始化与 Windows JDK 启动路径仍有失败；Rust LSP 尚未通过标准库类型推导。
- 6abf5b8 新增函数参数提示；前端类型检查和模拟 IPC 测试通过，原生 fixture 的自动缩进 / 括号输入验收在修复中，未宣布原生功能通过。
- ced1fb2 新增按文件合并待写快照、显式保存重试和冲突门闩；目前正在回归验证。

## 已实现，真实账号链路尚未验收
- 桌面独立官方隐私 WebView、原生 HttpOnly Cookie 读取、真实登录状态查询。
  仅内存会话；无凭据持久化。取消后忽略迟到响应。Android 安全登录隔离未开放。
- 在线运行 / 正式提交的单次写请求、固定中国站目的地、禁重定向、显式关闭 HTTP 客户端自动重试。
- 题目、账号、语言、源码、用例和操作 ID 的不可变快照；发请求前将快照原子写入本机评测日志。
- 已知评测编号继续查询；未知状态保留门闩，重启后不自动补交。用户核查后才能解除保护。
- 正式提交前确认；结果明确区分在线运行与正式提交，编辑后提示结果属于旧快照。
- 这些流程的协议/日志单元测试和模拟 IPC 前端竞态测试已通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38436028176 （2ca192f）。
  Linux 原生构建/回归：https://github.com/jacek4yang/inkleet/actions/runs/38436019694。
- 模拟测试不是真实登录、在线运行或正式提交通过。尚未使用私人账号在客户端验收。

## 尚未完成或受限
- 桌面安全会话持久化、Android 安全登录、会员题权限、题面图示/公式完整呈现。
- Typora、外部文件监听与冲突解决 UI；Android 系统文件导出。
- Markdown 预览暂不加载图片、可导航链接、公式扩展和嵌入内容；原始内容不改变。
- 补齐六语言本地 Runner、LSP、DAP；Python 与独立编译原型状态见上节，不能视为六语言已经完成。
- 中文 IME、移动软键盘、长时间资源使用、冷启动与原生内存完整测量。
- 正式 Android 签名身份、Windows/macOS 签名公证、干净系统安装/升级和真机验证。
- 浏览器预览仍只在内存保存，刷新前需导出。安装包构建成功不代表上述安装验收通过。

## 编辑器质量目标
参考 Zed / VS Code 核心编辑体验，保留极简刷题范围。
真实语言服务、真实调试、可靠保存和明确失败恢复均需逐平台证明。
不以“完美”替代验收，不将模拟、预览或单平台结果扩展为全部通过。

## 下一步
继续 Go 调试 UI 与六语言补全原生回归；补 C/C++ / Rust / Java 类型驱动与调试，修复 Windows Java 路径兼容。随后继续安全会话恢复、外部笔记、移动端与打包验收。
账号登录和签名等必须由用户参与的验证单独保留，不阻塞其余开发。用户要求持续推进全部既定功能，无须反复请求继续。
回到本任务时先读取最新分支、此状态文件和 Actions；上文只对列出的具体提交和 job 作证。
