# 保存时格式化
默认开启，设置 → 编辑器可整体关闭或按语言覆盖。自动保存原始草稿成功后，停止输入 1.2 秒再调用；Ctrl/Cmd+S 或 Ctrl/Cmd+Shift+F 可显式格式化。不会运行项目钩子、系统 PATH 工具或自动整理 imports。

Python Ruff 0.17.0；Rust rustfmt 1.99.0 / edition2021；Go 私有 gofmt；C/C++ clangd23.1 rangeFormatting；Java JDTLS1.61 rangeFormatting。
旧版 Go 安装收据没有 gofmt 校验，需要通过开发环境重新安装/修复一次。Rust/Python 的语言安装组现在包含格式化器。

单次源码/输出 ≤1 MiB，进程超时 5 秒；LSP edits 验证 UTF16/范围/重叠/虚拟脚手架边界，任何不安全结果整批拒绝。CLI 与 LSP 均保留原稿。格式化与磁盘冲突无关，不能解除已阻塞保存。

CodeMirror 使用 worker 中的 @codemirror/merge6.12.2 diff，2秒截止并终止 worker。结果应用前复核 EditorView、文档对象、generation、输入法状态；单个 ChangeSet/undo event，当前多光标通过 edits 映射，不恢复陈旧光标。输入、销毁、切换取消结果。撤销/重做不引发自动格式化循环。

配置为 version1 严格校验，原子/CAS 持久化并保留前版本，失败向用户反馈并保留配置编辑草稿。原稿保存后格式化失败，仍保留已保存正文。
许可证：Ruff MIT、CodeMirror merge MIT 随公共资源交付，Rust 工具链原许可证保持。

验证截至本检查点：
- 8e962783 四操作系统真实 CLI formatter probe（Ubuntu、Windows、macOS Intel/ARM）全部通过，覆盖 Python/Rust/Go 的 Unicode/CRLF/import 保留/幂等和语法失败。
- 前端/保存接入与 Linux 六语言原生 GUI 新测试：待本提交运行，不能用 CLI matrix 代替客户端验收。
- Android 原生格式化未验证。
