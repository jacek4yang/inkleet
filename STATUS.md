# 墨题开发状态
更新时间：2026-10-13。仍是开发预览，不能作为日常力扣客户端发布。

## 已验证的里程碑
- Draft PR：https://github.com/jacek4yang/inkleet/pull/1
- 四个平台开发安装包构建通过，含 3 项 Rust 存储单元测试：
  https://github.com/jacek4yang/inkleet/actions/runs/38422890407
  源提交 c153ffc。Windows x64 NSIS、Linux x64 DEB、macOS Intel/ARM DMG。
  此次总运行失败仅来自 Android 工具路径错误，不能将总结果标成成功。
- Android ARM64 debug APK 在修复路径后构建通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38424105398
  源提交 dbfbc79。使用临时调试签名，不是可长期升级的正式发行身份。
- CodeMirror 六语言、Markdown 编辑、独立撤销状态、TypeScript 检查和前端 UI 测试通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38424676151
  源分支 d150950。已有桌面代码、笔记、手机布局真实 Chromium 截图。
- npm/Cargo 锁文件已提交。Artifact 下载、解压、截图检查已实际完成。

## 已实现但尚需完整验收
- 题目/语言独立草稿；不可变运行快照、重复提交门闩的领域模型及 6 项测试。
- 原生正文与 Markdown 文件存储、临时文件原子替换、显式保存失败提示。
- 外部文件版本不一致时拒绝覆盖。尚无文件监听和完善的冲突解决界面。
- Linux 原生 GUI 启动、真实文件保存、进程重启恢复、外部冲突保护已通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38427345271 （c14e3ca）。
- 万行 438,889 字符、32 次输入的 Chromium 受控测试 P95 26.8ms：
  https://github.com/jacek4yang/inkleet/actions/runs/38427518348 （a411b9c）。
  GitHub Runner / AMD EPYC 9V74 / 4 CPU；不是原生 IME 或手机真机性能结论。
- 桌面官方独立隐私 WebView 登录原型、原生 HttpOnly Cookie 读取和登录状态校验已编译通过。
  会话仅内存；尚未用真实账号验收，不代表登录闭环完成。Android 安全隔离尚未开放。
- 中国站真实公开题目、搜索和六语言官方模板在线探针已通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38430859673 （d85c15a）。
  独立探针 exit-code=0；不使用任何私人账号或凭据。
- 原生题库搜索、分页、题面净化与官方模板接入已实现；41a2142 前端测试通过。
  图示/公式、会员题权限和离线题目元数据恢复尚未完成。
- 新版四桌面安装包均构建通过：
  https://github.com/jacek4yang/inkleet/actions/runs/38429806981 （2dee2ff）。
  包含 CodeMirror 和临时会话登录原型，不包含随后完成的题库界面。
- 浏览器预览只使用内存和自编样例，刷新会丢未导出内容。
- 安装包“构建成功”不等于“安装、升级及日常使用验收通过”。

## 未完成
中国站真实账号登录验收、题库完整呈现与离线恢复、运行/提交；Markdown 渲染、Typora 和 Android 系统导出；
六语言本地 Runner、LSP、DAP、工具链管理；发布签名、安装升级兼容性；
真实 IME、长文本、键盘与辅助技术、多平台性能和故障恢复完整验收。
运行/提交按钮保持禁用，不伪造结果。

## 编辑器质量目标
以 Zed、VS Code 的核心编辑体验作为质量参考，界面保持刷题所需的克制。
不以“完美”替代可验证的验收：
1. 输入法组合输入不丢字；语言/题目切换、撤销与光标互不污染。
2. 常规代码输入和滚动持续流畅；记录机器、文件大小、帧率和延迟，未测不报数值。
3. 补全、诊断、跳转与重命名使用真实语言服务；过期结果不能污染新文档。
4. 调试使用真实 DAP 与六语言适配；启动、暂停、断点和停止均有资源清理验证。
5. 保存失败、磁盘不足、外部编辑和异常关闭有明确恢复路径，不能静默覆盖。
6. 登录凭据不进入日志/仓库/普通前端；远程页面没有工作台 IPC 权限。
7. 每次发布保留精确 SHA、测试报告、原生截图和各平台真实产物。

## 恢复入口
读取 feat/first-workbench 最新提交、PR #1、此文件和最新 Actions。
PR 保持 Draft，尚无正式 Release。下一步：真实中国站协议验证、桌面登录验收，再打通题库与运行提交闭环。
