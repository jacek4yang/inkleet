# 墨题开发状态
更新时间：2026-10-14 00:52 UTC。开发预览，尚未满足稳定版本或完整 IDE 验收。

## 代码入口
- 仓库：https://github.com/jacek4yang/inkleet
- 开发分支：feat/first-workbench
- Draft PR：https://github.com/jacek4yang/inkleet/pull/1
- 尚未合并主分支、打 tag 或发布正式 Release。
- 下面每项结果仅对列出的检查点作证；后续代码仍需回归。

## 工作台已经具备
- 六语言与 Markdown 的 CodeMirror 编辑器，Intel One Mono，独立草稿、撤销、光标与滚动状态。
- 原生源码 / notes.md 原子保存、重启恢复、版本冲突检测和待写快照合并；外部冲突不会自动覆盖。
- 中国站公开搜索、中文题面、官方模板、最近题目缓存。
- 官方题面 / 题解 / 提交页 / 竞赛链接归一化直达；严格校验目的域、路径和编码；重复打开不覆盖草稿，离线优先使用明确标注的已缓存题目。
- Markdown 的 Worker 预览和 HTML 白名单净化；不改动笔记原文。
- 软件私有工具目录、固定官方来源、SHA-256 / 长度校验、可取消续传、安装锁、受限解压与原子激活。不修改系统 PATH 或全局语言环境。
- Pyright、rust-analyzer、gopls、clangd（C/C++）、JDT LS：补全、悬停、参数提示、诊断、F12 / Ctrl+单击定义及只读标准库视图。Python 某些结果是 .pyi 类型声明，界面明确标识。
- 六语言普通函数题的本地类型驱动；F9 / 行号栏断点、暂停源码高亮、调用栈、变量、单步、继续和停止。设计类及特殊接口不属于已完成能力。

## 已通过的真实验证

### Linux 原生客户端
- 最新完整六语言原生检查点 b85fa77c：
  https://github.com/jacek4yang/inkleet/actions/runs/38488962422
- Python / Go / C / C++ / Rust / Java 均通过私有工具下载、补全 / 标准库定义、本地普通函数运行及真实调试 GUI。
- Go、C、C++、Rust、Java 覆盖原始源码断点、变量 total 初值、F10 后真实变化及停止。Java 同时验证异步断点事件消除“未验证”提示；Python GUI 暂停栈及独立协议单步检查分别记录。
- 同一检查点通过真实 Pyright F2 重命名、引用同步及一次撤销还原；冲突对比、再次外部修改时拒绝覆盖、两版本恢复副本、明确选版本和后续保存。
- 同一次通过真实公开中国站搜索、官方 Rust 模板、链接打开、重复打开草稿保持、断网重启和离线链接缓存恢复。
- 匿名登录 UI 断言未通过，单独记录 UNVERIFIED；不代表已登录或在线运行 / 提交通过。
- WebKit WebDriver 间歇性连接重置仍在处理。5f15db9 的原生回归在关闭源码视图时失败，不能算通过；12e86c2 添加真实 OS Escape 后备并保留关闭断言，该次完整原生回归通过：https://github.com/jacek4yang/inkleet/actions/runs/38490623516 。不重放提交或调试单步，不用 DOM 注入制造结果。

### 四种桌面目标的协议 / 驱动
四平台指 Linux x64、Windows x64、macOS Intel 和 macOS ARM，不代表四平台 GUI 已实测。
- Python LSP / DAP、私有 Rust / C / C++ 编译的完整工具链检查点：
  https://github.com/jacek4yang/inkleet/actions/runs/38487185974
- Go LSP 与隐式链表 / 树成员补全：https://github.com/jacek4yang/inkleet/actions/runs/38489104366
- Go 类型驱动：https://github.com/jacek4yang/inkleet/actions/runs/38475942153
- Go 原始源码断点 / 变量 / 单步：https://github.com/jacek4yang/inkleet/actions/runs/38477220783
- C++ 类型驱动：https://github.com/jacek4yang/inkleet/actions/runs/38479816166
- C 类型驱动：https://github.com/jacek4yang/inkleet/actions/runs/38479816192
- Rust 类型驱动：https://github.com/jacek4yang/inkleet/actions/runs/38482548951
  Windows 使用私有 Rust LLD / GNU std / MinGW；Mac 保留对象内 DWARF，不要求系统 dsymutil。
- Java LSP / JDK 源码字节比较 / 隐式节点补全：https://github.com/jacek4yang/inkleet/actions/runs/38489104372
- Java 类型驱动：https://github.com/jacek4yang/inkleet/actions/runs/38483952343
- Java 调试协议：https://github.com/jacek4yang/inkleet/actions/runs/38485072094
  已覆盖原始源码断点、栈、变量、单步变量变化、继续与终止。
  Windows 中文 / 空格路径由应用自有 UTF-8 JNI 启动器处理，不改系统代码页、不修改上游 JDK 二进制。
  Java 调试核心通过 stdio；JDI 必需的调试连接仅绑定本机回环。表达式求值 / 热替换等未实现能力不宣称支持。

## 新增能力与回归边界
- 后端拥有语言工具安装队列：关闭环境窗口也继续处理 Go → gopls 依赖，完整原生回归已通过。
- 元数据驱动的虚拟 Solution / ListNode / TreeNode、Java 默认 import，以及 Python typing / future import 兼容。固定辅助片段仅用于语言服务，不写入保存或提交源码。
  Python / Rust 真实补全四平台：https://github.com/jacek4yang/inkleet/actions/runs/38487185974
  C++ 隐式节点补全四平台：https://github.com/jacek4yang/inkleet/actions/runs/38489104368
  Go / Java 的四平台节点补全见上。C 有固定类型单元测试和原生标准补全，但尚无同等专门节点协议探针。
- 退出时关闭进程启动入口，清理应用拥有的工具进程组 / Windows Job；不按名称扫描其他程序。父子进程、有界停止、重复停止与退出后拒绝新启动的四平台核心探针已通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38487185944
  这不等同于四平台 GUI 退出均已实测。
- F2 重命名拒绝跨文件 / 虚拟辅助代码 / 过时版本 / 重叠编辑；单次编辑事务支持整体撤销。
- 冲突解决前持久保存两份已审阅版本，外部文件再次变化时拒绝继续。恢复副本有数量和总量上限；后续 c75c4be 新增恢复历史浏览、预览与显式恢复。
- 5f15db9 新增 Typora / 系统 Markdown 编辑器打开；手动刷新或重新聚焦时检查笔记。干净草稿更新，脏草稿转冲突对比。前端与 Rust 单元测试已过，7aab441 实际文件修改与手动刷新原生断言通过；真实 Typora 启动尚未实测。不是连续文件系统监听。
- c786812 新增官方 SDK Android 模拟器真实安装、输入、私有笔记文件和重启恢复工作流，正在运行。x86_64 模拟器不能替代 ARM64 真机验收。
- 7aab441 的原生工作流中，Shift+F12 真 Pyright 引用、笔记外部刷新、恢复历史预览与磁盘恢复的独立断言已通过；但该工作流后来在 Java 本地面板切换时遭遇 WebKit 传输重置，整体失败，不能算完整回归。证据：https://github.com/jacek4yang/inkleet/actions/runs/38491977689
- 04eae7c 新增显式暂停栈帧表达式求值，3 秒超时停止、重复请求抑制、过时暂停结果丢弃；Java 未开放此能力。正在回归。
- 失败和取消的工作流不算通过；最终分支资格仍需重新汇总。

## 登录与在线判题：尚未真实账号验收
- 已实现独立官方隐私 WebView、HttpOnly Cookie 原生读取和登录状态查询；当前仅内存会话。
- 在线运行 / 提交只向固定中国站地址发送一次写请求，禁止重定向及自动重试。
- 不可变题目 / 账号 / 语言 / 代码 / 用例快照；发送前落本机日志，未知结果不自动补交，已知编号可继续查询。
- 正式提交前确认，旧快照结果明确标识。
- 单元与模拟 IPC 验证不代表账号登录、在线运行或提交通过。浏览器登录成功也不等于原生软件已认证。
- 安全凭据持久化、重新登录 / 退出 / 账号隔离、Android 登录仍需实现和单独授权验收。凭据不得进入代码、CI、截图或测试附件。

## 使用限制与剩余验收
- 环境隔离不是安全沙箱。仅运行可信代码，权限等同当前用户。
- 普通运行 10 秒、输出 64 KiB；编译预算按语言分离。Java 堆限制 256 MiB，其他语言暂无硬内存限制。
- 仍需引用与新表达式能力的跨语言完整回归、复杂类型与设计类题驱动、长时间资源 / 冷启动 / IME 回归。
- 连续外部文件监听、恢复历史的长期兼容性、实际 Typora 集成验收、Android 系统导出仍需完成。
- Markdown 图片 / 导航 / 公式及题面图示公式尚有范围限制。
- Windows/macOS 真机 GUI、干净系统安装升级、签名公证、Android 正式签名与真机验证尚未完成。
- 浏览器前端预览仍是内存模式，不能等同本地原生软件。

## 安装包
最新完整五目标构建为 a62a3db：
https://github.com/jacek4yang/inkleet/actions/runs/38489326380
Windows NSIS、Linux DEB、macOS Intel/ARM DMG、Android ARM64 Debug APK 全部构建成功。
Linux DEB 通过实际安装位置的启动、笔记/源码持久化与冲突 GUI；其他目标仅构建通过。这些包包含六语言工具、运行/调试、F2、冲突解决和退出清理，不包含后来的 Typora 集成。
桌面包未签名；Android 为 Debug，尚未完成体积优化与真机验证。Actions 产物保留 7 天，不是正式 Release。

### Linux tar.gz
已交付基于同一 a62a3db 已验证 DEB 的解压版：
https://github.com/jacek4yang/inkleet/actions/runs/38492041706/artifacts/11861114739
文件约 6 MB，SHA-256：47c7d037008f688f457040105e87d4f22e3a7c99f08c458cabd066256d0b8eb4。
GitHub 下载需登录，产物保留 30 天；未发布正式 Release。解压执行 start.sh，仍依赖系统 WebKitGTK 4.1 / GTK3。
0c6057a 已把 tar.gz 和解压后 GUI 检查加入后续 Linux 桌面构建，但该新增构建步骤尚待下一次手动打包实际运行。

## 下一步
持续推进 Android 实际运行、笔记外部编辑与恢复、编辑器与调试剩余能力、账号链路和长期稳定性。必须由用户参与的授权、账号或签名步骤单独保留，不阻塞其他开发。
历史检查点保留在 Git 历史中；本页不将历史失败或陈旧能力描述混作当前状态。
