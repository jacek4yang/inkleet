# 墨题开发状态
更新时间：2026-10-13 23:56 UTC。开发预览，尚未满足稳定版本或完整 IDE 验收。

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
- Python / Go / C / C++ / Rust 私有工具安装、补全 / 定义，以及本地运行 / 调试检查：
  https://github.com/jacek4yang/inkleet/actions/runs/38483095924
  该次 Rust、Go、C、C++ 均验证原始源码断点、变量 total 初值及 F10 后真实变化；不是模拟 IPC。
- 同一次还通过 Java 成员补全及 JDK 标准库源码窗口。
- 同一次通过真实公开中国站搜索、官方 Rust 模板、链接打开、重复打开草稿保持、断网重启和离线链接缓存恢复。
- Java 本地运行与调试 UI 已接入，但新的完整原生回归尚未通过，不能将下面协议测试替代 GUI 验收。
- 原生 WebKit WebDriver 曾发生连接重置。截图只能证明当时画面，不能由此断言应用崩溃；测试记录恢复，绝不重放在线提交或调试单步。截图可降级为真实 X11 桌面截图，功能断言不跳过。

### 四种桌面目标的协议 / 驱动
四平台指 Linux x64、Windows x64、macOS Intel 和 macOS ARM，不代表四平台 GUI 已实测。
- Python LSP / DAP、私有 Rust / C / C++ 编译的完整工具链检查点：
  https://github.com/jacek4yang/inkleet/actions/runs/38479816268
- Go LSP：https://github.com/jacek4yang/inkleet/actions/runs/38474190971
- Go 类型驱动：https://github.com/jacek4yang/inkleet/actions/runs/38475942153
- Go 原始源码断点 / 变量 / 单步：https://github.com/jacek4yang/inkleet/actions/runs/38477220783
- C++ 类型驱动：https://github.com/jacek4yang/inkleet/actions/runs/38479816166
- C 类型驱动：https://github.com/jacek4yang/inkleet/actions/runs/38479816192
- Rust 类型驱动：https://github.com/jacek4yang/inkleet/actions/runs/38482548951
  Windows 使用私有 Rust LLD / GNU std / MinGW；Mac 保留对象内 DWARF，不要求系统 dsymutil。
- Java LSP / JDK 源码字节比较：https://github.com/jacek4yang/inkleet/actions/runs/38483874856
- Java 类型驱动：https://github.com/jacek4yang/inkleet/actions/runs/38483952343
- Java 调试协议：https://github.com/jacek4yang/inkleet/actions/runs/38485072094
  已覆盖原始源码断点、栈、变量、单步变量变化、继续与终止。
  Windows 中文 / 空格路径由应用自有 UTF-8 JNI 启动器处理，不改系统代码页、不修改上游 JDK 二进制。
  Java 调试核心通过 stdio；JDI 必需的调试连接仅绑定本机回环。表达式求值 / 热替换等未实现能力不宣称支持。

## 最新开发，仍待完整回归
- 后端拥有语言工具安装队列：关闭环境窗口也继续处理 Go → gopls 依赖，重复安装不会新建同一任务。
- 元数据驱动的虚拟 Solution / ListNode / TreeNode、Java 默认 import，以及 Python typing / future import 兼容。
  固定辅助片段仅用于语言服务，不写入用户保存或在线提交的代码；自定义类型重复、注释 / 字符串伪定义及行号映射有回归用例。真实 Python / Rust 类型补全四平台探针正在运行。
- 退出时关闭新进程启动入口并清理仍由应用拥有的工具进程组 / Windows Job；使用所有权句柄，不扫描或按进程名称终止其他程序。跨平台退出探针和原生回归正在运行。
- 测试失败和取消的工作流不算通过；当前分支最终资格必须重新汇总。

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
- 仍需重命名 / 引用等编辑能力、复杂类型与设计类题驱动、调试表达式、长时间资源 / 冷启动 / IME 回归。
- 外部文件监听、冲突解决 UI、Typora 集成、Android 系统导出仍未完成。
- Markdown 图片 / 导航 / 公式及题面图示公式尚有范围限制。
- Windows/macOS 真机 GUI、干净系统安装升级、签名公证、Android 正式签名与真机验证尚未完成。
- 浏览器前端预览仍是内存模式，不能等同本地原生软件。

## 安装包
最近完整五目标构建仍是旧检查点 9daa959：
https://github.com/jacek4yang/inkleet/actions/runs/38459086881
Windows NSIS、Linux DEB、macOS Intel/ARM DMG、Android ARM64 Debug APK。
Linux 曾从实际安装位置通过 GUI 回归；其他目标仅构建通过。旧包不包含本页后来新增的六语言功能，需在新检查点回归后重新构建。Debug APK 尚未完成体积优化。

## 下一步
持续完成 Java 原生调试、六语言真实题目语义服务、安装 / 退出鲁棒性，再推进编辑与笔记体验、账户链路及移动端打包。仅必须由用户参与的授权、账号或签名步骤单独保留，不阻塞其他开发。
历史检查点保留在 Git 历史中；本页不将历史失败或陈旧能力描述混作当前状态。
