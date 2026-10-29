# InkLeet 使用手册

本手册描述当前 0.1.2 源码。公开安装包以对应 Release 的版本、源码和校验记录为准；测试与平台验收边界见 [STATUS.md](../STATUS.md)。

## 工作台
左侧题库与最近题目，中间题面或笔记，右侧代码。顶栏图标提供专注、题库、链接和设置。
语言选择保留原生键盘操作。Tab 在编辑器内缩进或接受补全；Shift+Tab 反向缩进。普通模式下 Escape 后 Tab 可离开编辑器；Vim 模式使用 Ctrl+M 后 Tab。
高级功能通过设置进入。成功读取、保存和刷新文件不常驻显示说明；保存失败与冲突仍会提示。

## Reading controls

On desktop-width windows, the statement toolbar offers a 10-32 px font size and explicit Chinese/English selection. If the requested text is absent, the available language is shown with a notice. Font size does not change the code editor. The top-bar toggle hides the statement without closing the editor or discarding its draft.

Drag the vertical separator to resize the statement. Arrow keys adjust it, Shift increases the step, Home/End select bounds, and Enter or double-click resets it. Escape or an interrupted drag restores the starting width. Preferences are stored locally. Previous/next buttons follow the current filtered page, not numeric question IDs; unavailable or paid neighbors are disabled.

## Compiler output

Local error output includes bounded diagnostic summaries for the six supported languages, source excerpts where ownership can be verified, and full captured raw output. Copy copies the raw output and reports clipboard failures. A location is clickable only for the known source filename and an in-range line while the editor still matches the run snapshot. External paths and stale snapshots remain display-only. Unsupported output remains available verbatim; the summary is not a substitute for native compiler acceptance.

## 设置
设置按实际功能分组。搜索支持中文、英文和多词筛选，例如 Vim、Tab、Rust 格式化；只展示匹配的设置及必需的关联项。搜索代理地址会保留连接方式；自定义代理的地址与连接方式一起编辑。

Editor settings include a font selector for installed fonts, with a default Intel One Mono and CJK fallback stack. Missing fonts fall back; selection does not download fonts. The separate Intel One Mono entry shows font information.

设置窗口中 Ctrl+F（macOS Command+F）聚焦搜索；清除图标清空搜索，Escape 关闭当前弹窗。运行面板的信息图标直接打开使用手册。

“已修改”仅筛选编辑器中偏离默认值的设置，不检查下载配置。语言覆盖即使与全局开关一致，仍属于明确覆盖；“继承”跟随当前全局保存时格式化开关。重置语言项只移除该语言覆盖。重置下载代理会一起恢复跟随系统和空地址。

重置和编辑只改变当前草稿；编辑器与下载分别保存，互不代替。分类和搜索切换保留草稿、错误及正在进行的操作，不触发保存或重新读取。关闭设置会丢弃未提交的设置草稿；已经提交的保存不会因关闭窗口撤销。

“重新读取”成功后才替换草稿并清除先前错误；读取失败保留草稿。隐藏页面的配置错误会显示“查看”，返回原设置后可检查完整原因。该入口不会自动重试。普通格式化运行状态与配置读取、保存错误分别显示。

## 编辑器命令与语言分析
代码编辑器获得焦点后，Ctrl+Shift+P（macOS 为 Command+Shift+P）打开编辑器命令面板。输入名称筛选，方向键选择，Enter 执行，Escape 关闭并返回编辑器。

The toolbar command button opens workbench commands. Ctrl+Shift+P (Command+Shift+P on macOS) also opens them outside the focused editor; inside the editor, its palette includes available workbench actions. Settings support additional custom shortcuts for listed editor and workbench commands, without replacing the existing defaults. Named keybinding presets are not provided.

- F2: rename a symbol in the current solution through LSP; one undo restores the change. Use Preview or Shift+Enter to review edits before applying them. Cross-file edits are not supported.
- Ctrl+.（macOS Command+.）：请求当前选择的代码操作，先查看完整修改预览，再明确应用；一次撤销恢复原文。仅接受受支持语言服务的当前解答源码编辑，不保存文件或执行命令。
- F12：转到定义；工具链源码在只读窗口打开。
- Shift+F12：查找当前解答中的引用。
- Ctrl+Space：补全；Ctrl+Shift+Space（macOS 为 Command+Shift+Space）：参数提示。
- Linux Ctrl+Shift+I；Windows Shift+Alt+F；macOS Shift+Option+F：格式化文档。
- Ctrl+S（macOS Command+S）：按设置格式化当前版本，再保存；设置关闭时直接保存。

设置 → 编辑器可配置保存时格式化，支持语言覆盖。只有显式保存才自动格式化，停顿、切换焦点均不会触发。格式化或写入失败时保留当前草稿和原有磁盘文件，未保存标记不会消失；格式化结果可撤销。手动格式化只修改编辑器内容，不代替保存。工具尚未安装时需要先安装对应语言环境。

语法着色使用 CodeMirror/Lezer 增量解析；支持的语言服务器额外提供语义分类。语义结果随源码版本隔离，编辑后旧分类立即清除。服务器不支持或暂时失效时保留基础着色。并非所有语言服务器都提供语义标记。
只读源码窗口支持继续转到定义：F12、Ctrl+左键（macOS 为 Command+左键），Vim 普通模式可使用 gd。Alt+左/右返回或前进；Vim 可使用 Ctrl+O / Ctrl+I。跳转仍取决于当前语言服务器提供的位置及已安装的源码。代码操作支持的语言服务、快照与当前文件边界见 [编辑能力矩阵](EDITING_SUPPORT.md)；不提供任意跨文件修改或服务器命令执行。

## Tab 显示宽度
设置 → 编辑器 → Tab 显示宽度，范围为 1–8，默认 4。保存设置后更新代码、笔记和只读源码窗口中的制表符显示，不自动将已有源码中的空格或制表符互相转换，不改变语言缩进单位和格式化策略。混合缩进时，编辑命令仍会按 CodeMirror 的列计算规则工作。

配置保持版本 1；缺少 tabSize 字段表示默认 4。界面保存默认值时移除此字段。旧版严格配置读取器可能拒绝包含该字段的配置，切回旧版前应在新版选择默认值并保存；恢复副本仍可能包含新字段。

## Vim
设置 → 编辑器 → Vim 可动态开启，代码和 Markdown 笔记共用此开关。切换不会重建文档或清空撤销历史。
支持常用移动、操作符、文本对象、搜索、可视选择、重复、撤销和重做。输入模式保留语言缩进和补全；普通模式 Tab 不修改缩进。Escape 返回普通模式。
:w 走与 Ctrl+S 相同的保存流程，遵守保存时格式化设置。文件名参数、强制写入、:q、:wq 不提供额外文件写入或退出行为。完整 Zed Vim 功能、原生中文 IME 组合输入仍需专项验证。

## 环境与下载
设置 → 语言与环境 → 开发环境，选择语言并安装缺少的工具。
工具保存在应用私有目录，不修改系统 PATH，不要求预先安装语言运行时。
固定版本与 SHA-256 校验；失败保留下载断点。关闭环境窗口后安装继续。
Go 语言服务首次安装使用独立 Go 编译固定源码，可能需要几分钟。
Windows Java 使用应用自己的 UTF-8 启动器，不修改系统语言设置。

设置 → 下载可选跟随系统、直连、自定义 HTTP/HTTPS 代理。
自定义代理应使用 HTTP 或混合端口，当前不支持地址中包含账号密码。
代理仅用于工具链、LSP、调试器安装下载及 gopls 依赖。不会改变力扣访问、用户代码运行或系统网络。
保存后仅影响新安装，已经开始的安装保留原连接方式。

来源包括 Python Build Standalone、Node.js、Microsoft Pyright/debugpy/Java Debug、Eclipse Temurin/JDT LS、Rust、Go 及校验模块代理、Zig、LLVM clangd、CodeLLDB、Delve。

## 运行与调试
本地面板从题目提供的官方样例初始化测试用例。用例可增加、改名、删除和切换，按题目与解答保存到本机。已知函数参数显示独立输入框，每个参数填写一个 JSON 值；无法可靠拆分的输入保留文本编辑。调试使用当前选中用例。
运行结果默认展示实际返回值、标准输出和错误，原始协议内容可通过更多入口展开。运行后修改源码或输入会标记结果过期；不会自动编造期望输出或判定通过。底部面板可拖动改变高度或收起。
仅运行可信代码。工具目录隔离不是安全沙箱，程序使用当前用户权限执行。
本地输出不代表力扣判题结论。普通运行限时 10 秒，标准输出/错误上限 64 KiB；结构化结果文件最多 1 MiB，超过限制不会标记为符合预期。
调试连续执行限时 30 秒，会话最多 30 分钟。编译预算按语言区分。

先通过代码栏终端图标打开一次本地面板，再使用以下调试快捷键。首次直接 F5 打开面板的流程尚未接入。普通输入框、笔记、弹窗和输入法组合输入不触发全局调试键。

- F9：切换当前行断点
- F5：开始或继续
- Shift+F5：停止
- F10：单步跳过
- F11：单步进入
- Shift+F11：单步跳出

行号左侧分别预留断点和执行箭头位置，点击断点槽或按 F9 设置断点。暂停行以琥珀色标记，点击或选中文字不会清除暂停色；修改源码会使旧暂停位置失效。
在调用栈选择帧后检查该帧变量。展开变量不会替换父节点。
表达式只在明确操作时求值，可能调用函数或改变程序状态；3 秒超时会停止当前调试。
监视表达式仅手动刷新，不会自动重复执行。Java 表达式求值尚未支持。
代码或用例改变后，既有调试仍对应启动时快照。界面的过期标识不可忽略。

## 保存、笔记与恢复
原生客户端按题目、语言与命名解答隔离源码。编辑期间只更新恢复草稿，Ctrl+S 或保存图标才写入正式文件；未保存时显示圆点。关闭时等待正在进行的写入，并对尚未保存内容提供保护选项。重启可恢复未保存草稿。不要同时运行多个版本写同一份文件。

### 解答归档与恢复

解答菜单中的「归档解答」需要确认；随后从活动列表移除，切回默认解答。「已归档」中可按原名称和原 ID 恢复。默认解答不能归档，始终保留一个可用入口。

归档不是删除：正式源码、未保存草稿和冲突恢复副本都留在原目录，共享笔记不变。归档会等待已请求的保存和草稿写入；保存失败、磁盘源码或恢复草稿发生变化时会拒绝，先处理冲突再重新确认。恢复后未保存内容仍显示未保存，不会自动覆盖正式源码。

名称及每种语言 128 份的上限包含归档记录，避免恢复时同名覆盖。没有永久删除或自动清空归档功能；需要腾出空间时先导出/备份，关闭应用后自行整理。旧版不识别已归档记录，切勿让不同版本同时写入工作区。归档/恢复报错但状态不确定时，关闭对话框并刷新列表确认，不要盲目重复。

外部编辑器修改笔记后，返回应用会检查更新；也可在设置中手动刷新。
干净草稿可以更新，脏草稿与外部修改发生冲突时必须先比较。不会静默覆盖。
保存失败时保留内存草稿，先导出再处理磁盘错误；恢复副本不等于完整版本历史。
浏览器预览只有内存草稿，刷新前需要导出。

## 账号与在线评测
当前源码提供原生二维码登录和官方窗口备用流程。 For the fallback, complete login in the official window, then return and verify. QR login and restored sessions are validated by the native client before exposing account identity.
Remember-login is optional and uses the OS credential store, never plaintext files or editor JavaScript. 真实账号完成、跨重启会话与每个平台存储分别验收；合成凭据探针和浏览器夹具不代表真实账号通过。 A locked or unavailable store, or uncertain cleanup, can block login until resolved; cancel/sign-out do not silently ignore credential cleanup errors. See [native login limitations](NATIVE_LOGIN.md).
公开题库无需登录。登录后才能使用账户完成状态及在线评测。
运行或提交才发送当前代码与测试用例；不会上传笔记。正式提交仍需确认。
网络状态未知时不会自动重发；有评测编号时可继续查询原请求。
账号真实端到端验收与各平台原生验收请查看 STATUS.md，不能用浏览器模拟测试替代。


## 本地用例与批量运行

- 展开“预期结果”，明确选择返回值或调用后参数。留空表示未设置；JSON 的 null 是一个明确的预期值。
- 默认精确 JSON 比较保留数组顺序、忽略对象键顺序、拒绝重复对象键；等价十进制写法视为相同，不对大整数做浮点转换。
- 可明确选择十进制浮点容差：`|实际−预期| ≤ max(绝对误差, 相对误差 × max(|实际|, |预期|))`，递归比较数值且保留数组顺序。超出支持数值范围时显示无法比较，不判为通过。
- 可明确选择最外层数组无序比较：只忽略最外层顺序，保留重复次数和内层顺序；不是集合去重。不会根据题目猜测任何比较策略，也不声称等价于官方特殊判题。
- 一个命名用例包含多组函数调用时仍可运行，但暂不套用单个预期值比较。
- “运行全部用例”一次提交不可变快照，最多 64 个命名用例、共 100 组调用。整批编译一次，共享同一进程、10 秒执行预算和输出上限；不是每个用例独立的时限或沙箱。
- 运行后编辑代码、名称、输入或预期值不会改写已产生的结果，会标记结果过期。“重跑失败用例”由用户显式触发，使用当前代码和仍存在的对应用例；不会自动重试未知结果。
- 超时、停止、截断或异常退出时保留已有输出，不标记为符合预期；尚无输出的调用显示“未返回结果”，不声称它从未开始执行。
- 切换解答后返回，可从仍存活的后台任务恢复运行快照。任务上下文只在本次应用进程内保留，不是长期提交历史。
- 用例记录继续使用版本 2，兼容读取版本 1。0.1.1 等旧版不认识 `float-json` / `unordered-array`；读取含这些策略的记录会保留原记录、回退示例并仅内存编辑。回退前先备份/导出，不能把回退界面误认为原用例已经丢失。
- 本地“符合预期”不代表通过力扣判题。调试仍使用当前选中的单个用例。


### 设计类与零参数输入

Rust/Python 的受限设计类输入是连续两个 JSON 数组：操作名数组（首项为类名），以及与其逐项对应的参数数组。例如 `["Counter","add","get"] [[0],[2],[]]`。首项创建实例，后续仅调用题目元数据列明的方法；一组输出一个结果数组，构造和无返回值操作为 `null`。不同操作序列重新创建实例；它们仍共享同一进程与时间/输出预算。

普通函数零参数调用用 `[]`，每个 `[]` 表示一次调用。支持类型、Rust 方法约定、NestedInteger 和明确拒绝的接口见 [本地测试契约](LOCAL_TEST_POLICIES.md)。不从任意输入推测方法或官方判题策略。
