# Lithe-IDEA 固定源码对照与复用计划

日期：2026-10-14。源码检查不是运行验收；下列上游缺陷为静态观察，不声称复现了上游运行行为。

## 固定输入与架构边界
- Lithe-IDEA：`6210013d06e1410c7bcbb1949e1ff16ea8deae15`
- InkLeet：`dfca6d6cc159a38ede881c4df25448a37713993b`，P0 后续在 `feat/editor-p0-reliability`
- Lithe 共享前端使用 Monaco 0.55.1（[frontend/editor/package.json](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/frontend/editor/package.json)）；Windows 是 React/Tauri（[windows/tauri/package.json](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/package.json)），macOS 另有 SwiftUI/AppKit/WebKit 宿主（[macos/Sources/Lithe/Platform/MacOS/MonacoWorkbenchEditor.swift](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/macos/Sources/Lithe/Platform/MacOS/MonacoWorkbenchEditor.swift)）。
- InkLeet 保留 Tauri 2 + React + CodeMirror 6 + Rust。Monaco provider、ITextModel、Swift 视图均不是可直接使用的跨平台 CM 组件。
- 分类 A：纯 TypeScript 算法/无框架工具可经逐文件审查复用；B：借鉴规则，在 CM/InkLeet 中重实现；C：绑定 Monaco/Swift/宽泛插件基础设施，不移植。
- 当前 P0 未复制 Lithe 实现代码。A 表示候选适用性，不表示已复制或已验证。

## 功能对照
| 参考项 | Lithe 机制 | InkLeet 基线和缺口 | 分类 / 依赖 / 难度 | 验证方法 |
|---|---|---|---|---|
| Monaco 编辑配置 | 集中读取字体、tabSize、换行及选择性订阅 | CM 配置硬编码；已明确语言缩进默认值。缺动态配置层 | B；CM Compartment；中 | 设置改变时 EditorView/LSP 身份不变，源码/撤销/选区/滚动不变，不触发保存 |
| Settings defaults/normalization | 分离默认值与部分规范化 | 没有统一配置 schema | A/B；小型 TS schema，不需要 Zustand/Immer；低至中 | 非对象、未知键、NaN、范围、语言覆盖、默认值继承 |
| Settings search | 稳定 ID、关键词、非拉丁文字规范化、字段加权 | 没有设置搜索 | A；无框架工具；低 | 中文/英文、多关键词、稳定排序、空输入；实际搜索 UI 必须单测 |
| Settings migrations | 迁移保留显式选择 | 无配置版本 | A/B；版本化 envelope；中 | 幂等、旧版本、未来版本拒绝、未知字段不误覆盖 |
| Settings persistence | debounce patch、立即内存更新 | 当前 SaveQueue 用于文档，不应与偏好混用 | B；独立原生原子配置存储与确认结果；中 | 持久化失败可见、内存保留、reset/import 与在途写串行化、关闭等待明确完成 |
| Command Registry | 稳定命令 ID、元数据、集中派发 | 动作散落于 toolbar/组件与 CM keymap | A/B；小型 typed registry；中 | toolbar/palette/快捷键同一 execute 与 canExecute，错误可见 |
| 快捷键 presets | defaults→preset→user 合成 | 基本 CM 快捷键和局部调试快捷键 | A/B；规范化按键与上下文路由；中 | 全部有效绑定冲突，不仅用户项；输入框/弹窗/编辑器/调试器、IME、保留快捷键 |
| Command Palette | 搜索、键盘选择、历史 | 无统一面板 | B；React dialog+registry；中 | Esc 恢复焦点、禁用动作不可执行、失败不记为成功、在线提交仍走既有确认 |
| Completion 转换 | 保留原始 item/上下文、labelDetails、resolve 后合并元数据 | 已有大小上限、filter/sort、UTF-16、主/额外编辑同事务及重叠拒绝；缺 snippet/resolve/labelDetails | B；CM snippet+Rust协议与映射联动；高 | 过时结果、Unicode、导入+插入一次撤销、生成前缀拒绝、恶意文档仅纯文本 |
| 补全浮层 | Monaco editor overflow widget 设置 | 已使用 CM body portal、fixed、z-index 和命中测试 | B；不搬 Monaco 配置；低 | 窄窗口、滚动、缩放、邻面板、原生弹窗 top layer、销毁无残留 |
| LSP lifecycle | phase/operation ID、终态结果、owned event | 已串行 connect、迟到 start 自动停止、doc/version/session 验证；缺严格状态/错误恢复 | A/B；InkLeet 单活动服务；中 | 迟到启动、销毁、重复重连、断线、一次终态、无定时器泄漏 |
| pending document changes | 位置请求前 flush | 已 flush；但同步 Promise 被一次 rejection 污染后无法自行恢复 | B；复用现有队列职责，不另建路径队列；中 | update 拒绝后显式恢复，保留待同步最新内容，不伪称已同步 |
| cooldown/error classification | 有界冷却、区分取消/能力缺口/故障 | 当前显式补全有界重试，不重启服务；需结构化错误 | A/B；纯TS、Rust错误映射；中 | 取消不报故障、冷却到期行为、重复故障不刷进程、不同会话隔离 |
| Session view state | 文档内容与选区/滚动/折叠分离 | CM state/undo/scroll 按文档缓存，内容变化拒绝旧undo；缓存无上限、无重启视图恢复 | B；有界缓存和版本化视图状态；中 | 多题切换、外部更改、重启、较新导航覆盖迟到恢复、内存上界 |
| Document watch | 保存期间延后、generation、有限突发批次/继续处理 | 现有聚焦/手动笔记刷新+原子保存+冲突副本 | B；先借鉴测试，不引入 Git/workspace/native lease 整套依赖；高 | Typora写入与保存交错、过时响应、dirty draft不覆盖、失败副本保留 |
| 可调整面板 | 宽度 clamp，保留编辑区空间 | 固定布局；调试控件与滚动已分离 | A/B；React pointer/key处理；中 | 键盘调宽、最小宽、pointercancel、拖动中卸载、窄屏与浮层位置 |
| Vim | Monaco 适配与命令事件 | 目前无 Vim | B/C；独立 CM Vim 适配，不用 Monaco adapter；中至高 | 模式切换、IME、销毁监听、snippet Tab优先级、:w/:q/:wq明确保存完成 |
| Swift/Monaco/plugin 宿主 | macOS 原生桥、Monaco模型与平台服务 | 非当前架构 | C；不引入 | 不适用；仅检查交互设计，不声称移植 |

## 对应源码
### Settings
[windows/tauri/src/features/editor/engines/monaco/use-monaco-editor-settings.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/engines/monaco/use-monaco-editor-settings.ts)
[windows/tauri/src/features/settings/config/default-settings.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/settings/config/default-settings.ts)
[windows/tauri/src/features/settings/config/search-index.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/settings/config/search-index.ts)
[windows/tauri/src/features/settings/lib/settings-search.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/settings/lib/settings-search.ts)
[windows/tauri/src/features/settings/lib/settings-normalization.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/settings/lib/settings-normalization.ts)
[windows/tauri/src/features/settings/lib/settings-migrations.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/settings/lib/settings-migrations.ts)
[windows/tauri/src/features/settings/lib/settings-persistence.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/settings/lib/settings-persistence.ts)
[windows/tauri/src/features/settings/stores/settings.store.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/settings/stores/settings.store.ts)

### 命令、键位、补全
[windows/tauri/src/features/keymaps/commands/command-registry.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/keymaps/commands/command-registry.ts)
[windows/tauri/src/features/keymaps/defaults/keybinding-presets.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/keymaps/defaults/keybinding-presets.ts)
[windows/tauri/src/features/keymaps/utils/effective-keymaps.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/keymaps/utils/effective-keymaps.ts)
[windows/tauri/src/features/keymaps/hooks/use-keymaps.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/keymaps/hooks/use-keymaps.ts)
[windows/tauri/src/features/keymaps/hooks/use-keybinding-conflicts.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/keymaps/hooks/use-keybinding-conflicts.ts)
[windows/tauri/src/features/keymaps/utils/matcher.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/keymaps/utils/matcher.ts)
[windows/tauri/src/features/keymaps/utils/registry.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/keymaps/utils/registry.ts)
[windows/tauri/src/features/command-palette/components/command-palette.tsx](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/command-palette/components/command-palette.tsx)
[windows/tauri/src/features/editor/engines/monaco/lsp-completion.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/engines/monaco/lsp-completion.ts)
[windows/tauri/src/features/editor/engines/monaco/lsp-providers.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/engines/monaco/lsp-providers.ts)
[windows/tauri/src/features/editor/engines/monaco/lsp-completion.test.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/engines/monaco/lsp-completion.test.ts)

### 会话、文件、布局
[windows/tauri/src/platform/lsp-session-lifecycle.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/platform/lsp-session-lifecycle.ts)
[windows/tauri/src/features/editor/lsp/pending-document-changes.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/lsp/pending-document-changes.ts)
[windows/tauri/src/features/editor/lsp/language-server-failure-cooldown.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/lsp/language-server-failure-cooldown.ts)
[windows/tauri/src/features/editor/lsp/lsp-request-error.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/lsp/lsp-request-error.ts)
[windows/tauri/src/features/editor/lsp/owned-lifecycle-event.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/lsp/owned-lifecycle-event.ts)
[windows/tauri/src/features/editor/stores/editor-session-state.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/stores/editor-session-state.ts)
[windows/tauri/src/features/editor/utils/view-state-restore.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/utils/view-state-restore.ts)
[windows/tauri/src/features/editor/services/document-watch-controller.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/services/document-watch-controller.ts)
[windows/tauri/src/features/editor/services/document-watch-controller.test.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/services/document-watch-controller.test.ts)
[windows/tauri/src/features/layout/utils/resizable-pane-layout.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/layout/utils/resizable-pane-layout.ts)
[windows/tauri/src/features/layout/components/resizable-pane.tsx](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/layout/components/resizable-pane.tsx)
[windows/tauri/src/features/vim/stores/vim-commands.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/vim/stores/vim-commands.ts)

## 不照搬的已见风险
1. Settings persistence 的固定 300ms debounce 只是合并写入，不代表持久化完成；catch 仅记录错误。reset/import 未取消旧 pending patch，有后写覆盖风险。InkLeet 必须有版本、排队、明确完成、失败提示与保留。
2. Settings normalization 并非完整 unknown-input 验证。当前 settings-dialog/macOS panel 的源码未建立可用搜索 UI；不能因存在 search-index 就宣称搜索交付。
3. 快捷键冲突检查只覆盖存储的用户项，以原始字符串和精确 when 比较；多键 matcher 未充分校验先前 chord prefix。InkLeet 从完整有效绑定及明确上下文检查冲突，避免初期复杂 chord。
4. 命令执行日志吞错、历史提前记录、IME guard 不明确；本项目执行应返回真实结果，组合输入不被全局命令抢走。
5. Lithe lifecycle 转换函数不是强制验证转换的状态机；冷却不是服务已就绪证据。
6. Lithe 的 InsertReplaceEdit 转换不如 InkLeet 现有范围兼容完整，不回退现有能力。
7. 可拖动面板有 ARIA separator，但缺键盘调宽和拖动中卸载清理；不得照搬这些缺口。
8. Vim :wq/:x 发出 vim-save 事件后固定等待100ms，再读取 activeBufferId 并关闭；未 await 保存且未固定原始文档身份。InkLeet 必须固定文档+版本并 await 保存，失败不关闭；其他标签不会被迟到动作关闭。
9. InkLeet initialize 当前明确 snippetSupport:false，后端请求白名单也不含 completionItem/resolve。P1 必须同时修改协议能力、请求映射和 CM 转换，不能只删前端过滤条件。

## 必须保留的 InkLeet 合约
- SaveQueue 按文件合并、排序；失败文件阻塞待重试，不妨碍其他文件。
- 原生比较 expected baseline 后原子替换；冲突/恢复保留两份内容。
- 新设置/命令不能造成代码脏标记、重启 LSP 或覆盖草稿。
- 在线提交调用既有不可变、账号绑定快照和确认/未知结果机制；命令面板不能绕过。
- 多文件 Promise.all 不是事务；部分成功必须逐文件记录并允许恢复。
- 关闭未保存文档必须等待明确结果，磁盘满/权限/写失败保持编辑器及内存内容。

## 验收顺序与平台记录
P0→P1→P2→P3→P4；每一阶段独立分支与 Draft PR，记录代码 SHA、参考文件、直接移植或重写、兼容风险、截图与复现步骤。

浏览器 Playwright、Linux 原生 WebKitGTK、Windows 原生、macOS Intel/ARM 原生、Android 分别记录，不能互相替代。现有跨平台协议测试不等于 GUI 验收。真实中文 IME、性能与长期稳定性尚未验收。

性能基线至少包含普通题目及大文档输入延迟分布、React提交次数、CPU/内存、连续题目/语言切换后进程/监听器/Timer数量。固定工具与数据版本、平台和采样方法；不能用截图或一次CI绿灯替代长期结果。

## 许可证和移植记录
Lithe 根许可证为 [LICENSE](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/LICENSE)（Apache-2.0）。直接复制或修改分发时保留适用版权/许可证/署名；提供许可证副本、修改说明及适用 NOTICE。当前根目录未发现 NOTICE，不代表 vendored 资源没有独立义务。字体、图标、语法和依赖逐项核查。

每个真正移植文件必须记录：上游 SHA/path、原始许可证、保留声明、本地目标、修改摘要、测试。没有移植时明确写“设计参考、独立实现”，不虚构版权归属。当前 P0 是独立 CM 原生配置与回归测试。


## 指定测试的已读覆盖与边界
- [windows/tauri/src/features/settings/components/editor-font-settings.test.tsx](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/settings/components/editor-font-settings.test.tsx)：
  目录 loading/failed/empty 时保留自定义字体；目录恢复、选择字体、字号边界6/72、连字配置、preview 与设置一致。持久化是 mock，Select 被替换，编辑器是 options probe；不是原生落盘、真实浮层或 EditorView 不重建的证明。
- [windows/tauri/src/features/settings/components/keyboard-settings-routing.test.tsx](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/settings/components/keyboard-settings-routing.test.tsx)：
  keyboard 路由、快捷键搜索、录制 Ctrl+Alt+B、Import/Export、Reset 回默认、空结果。这里确实有键盘子页面搜索；上文未建立的是全局 Settings 搜索入口。原生文件操作、dialog/动画/toast等有 mock，不能据此宣称 IME、真实焦点和系统快捷键通过。
- [windows/tauri/src/features/editor/lsp/pending-document-changes.test.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/lsp/pending-document-changes.test.ts)：
  同文件两次变化排队/take清空；await flush 等待注册 flusher 完成；无 owner 返回undefined；unregister后不调用。没有覆盖失败恢复、旧owner注销新owner、文档关闭、真实 didChange 被服务端处理。
- [windows/tauri/src/features/editor/lsp/language-server-failure-cooldown.test.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/lsp/language-server-failure-cooldown.test.ts)：
  注入时钟，冷却边界前1ms仍禁止、边界恰好到达解除并清理、显式clear立即解除。纯函数边界测试，不证明服务启动或自动重试。
- [windows/tauri/src/features/editor/services/document-watch-controller.test.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/services/document-watch-controller.test.ts)：
  借鉴保存中延后、generation、突发变化有限处理及继续处理的竞态测试；不引入其整个workspace/Git/lease依赖。
- [windows/tauri/src/features/editor/engines/monaco/lsp-completion.test.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/engines/monaco/lsp-completion.test.ts)：
  借鉴元数据与resolve合并的测试性质，另补 InkLeet 的 UTF-16、生成辅助前缀、过时会话、重叠 edits、snippet 占位符以及真实CM焦点。

## Vim 与安全关闭补充
[windows/tauri/src/features/vim/stores/vim.store.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/vim/stores/vim.store.ts) 使用全局模式 store，adapter 是每个编辑器实例。[windows/tauri/src/features/editor/engines/monaco/vim-commands.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/engines/monaco/vim-commands.ts) 依赖 monaco-vim；真正 adapter 生命周期在 [windows/tauri/src/features/editor/components/monaco-editor.tsx](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/components/monaco-editor.tsx)。模式归属需按活动编辑器验证，不能因任一实例销毁而误改其他实例模式。

固定 tree 的 features/vim 有三个源文件；没有名称含 vim 的测试路径，不排除间接覆盖。[shared/platform-feature-matrix/features/vim-mode.json](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/shared/platform-feature-matrix/features/vim-mode.json) 标记 Windows implemented、verification pending，macOS missing；不能把上游实现存在等同成熟跨平台验证。

固定100ms问题只针对已读 Vim :wq/:x 路径，不扩大为所有关闭流程：[windows/tauri/src/features/window/components/pending-buffer-close-dialog.tsx](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/window/components/pending-buffer-close-dialog.tsx) 和 [windows/tauri/src/features/window/components/window-close-guard.tsx](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/window/components/window-close-guard.tsx) 会 await 明确 saved；[windows/tauri/src/features/editor/services/document-save-lifecycle.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/windows/tauri/src/features/editor/services/document-save-lifecycle.ts) 使用 operationId/revision。这些明确完成与归属规则才值得借鉴。:q! 的注释说 force，但代码仍调用普通 closeBuffer，语义也需独立实现与测试。

## frontend/editor/src 复用边界补充
- A 候选：[frontend/editor/src/content-sync.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/frontend/editor/src/content-sync.ts)（最多8个旧回显快照）、[frontend/editor/src/run-markers.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/frontend/editor/src/run-markers.ts)（纯数据校验/去重）、[frontend/editor/src/color.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/frontend/editor/src/color.ts)（颜色转换）。有真实需求再取，不取代已有版本身份。
- B：[frontend/editor/src/source-text.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/frontend/editor/src/source-text.ts) 的 piece tree/undo 分支依赖 Monaco alternativeVersionId；CM已有文档历史权威，不增加第二套。[frontend/editor/src/source-text.test.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/frontend/editor/src/source-text.test.ts) 的 mixed EOL、emoji、redo分叉、外部替换、2001次编辑还原测试值得借鉴。
- B：line-endings.ts/model-uri.ts/semantic-token-types.ts/semantic-tokens.ts/token-theme-roles.ts 的数据规则需适配文档身份和 CM highlight；不能擅自规范化源码原始换行。
- C：workbench.ts/diff-review.ts、model-lifecycle.ts/model-content.ts/model-source.ts、editor-commands.ts/completion-kind.ts、native-find.ts、Monarch/TextMate/Oniguruma/worker启动均绑定Monaco或其运行时。
- C：[frontend/editor/src/word-highlight-lifecycle.ts](https://github.com/1lck/Lithe-IDEA/blob/6210013d06e1410c7bcbb1949e1ff16ea8deae15/frontend/editor/src/word-highlight-lifecycle.ts) 修补 Monaco 0.55.1 的私有 highlighter._run；不是通用生命周期工具。
- 共享 workbench 的关闭锁 await activation/drainInput/entry.chain 再返回revision/text，最多三次0ms事件循环检查点不是“100ms之后猜测保存成功”。已审查入口/同步/关闭/请求归属重点，没有声称完整审计87KB文件。

测试迁移使用现有 node:test / Playwright / Rust，不为借鉴测试再引入 Bun、Monaco 或上游全局 stores。
