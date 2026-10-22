# 编辑器设置与 JSON

设置中的“可视化”和“JSON”编辑同一份草稿。只有保存成功后才生效。JSON 是严格 JSON，不支持注释、尾逗号、重复键或未知字段；限制为 4096 UTF-8 字节。

- [完整默认示例](editor-settings.example.json)
- [JSON Schema](editor-settings.schema.json)

给其他 AI 的要求：生成符合以上 Schema 的 InkLeet 设置对象，不要输出 VS Code 或 Zed 的配置，不要写 revision、账号、密码或任意命令。vim 默认 false。将返回内容粘贴到设置 JSON 中，检查校验结果后保存。

保存使用打开草稿时的文件版本校验，保留上一份有效文件备份。外部程序修改配置后，旧草稿不能覆盖新文件。可以导出草稿，再明确重新读取；失败不会自动清空草稿。

新字段均可省略，旧 version:1 配置继续有效。主题/字体/行高作用于代码、笔记和源码阅读器；wordWrap 改变代码显示而不修改文件内容；笔记仍自动换行。下载代理属于独立设置文件，不在此 JSON 中。

主题提供浅色、深色和跟随系统。可选 colorOverrides 对象分别保存 light / dark 模式的颜色覆盖；未填写的颜色继承原有配色，不会把一套颜色自动复制到另一模式。自定义配色控件与 JSON 共用草稿，保存后生效。

允许的颜色键：surface（窗口背景）、editor（编辑区背景）、side（侧栏）、ink（正文）、muted（次要文字）、line（分隔线）、hover（悬停）、accent（强调色及普通光标）、selection（选区）、active（当前行）、cursor（Vim 块状光标）。只接受 #RRGGBB 六位十六进制，不接受 CSS 表达式、URL、变量或其他键。支持下列固定语法分类颜色，不接受任意 CSS 选择器。快捷键使用下面列出的受支持命令与附加键格式，不接受任意 Vim 映射。

[自定义配色示例](editor-settings.colors.example.json) 可以直接粘贴。自选颜色可能降低对比度，保存前请检查前景/背景搭配；“恢复此颜色”只删除当前模式的当前项，行右侧重置删除全部颜色覆盖。切换主题本身不会删除颜色配置。

## 命令面板与附加快捷键

Ctrl+Shift+P（macOS Command+Shift+P）从工作台打开命令面板；在代码或笔记编辑器中打开时，同时列出该编辑器的命令与工作台命令。工具栏也有命令面板入口。已有弹窗保持自己的键盘焦点，不从其背后打开其他窗口。

可选 keybindings 对象将命令 ID 映射到附加快捷键。例子：
```json
{"version":1,"formatOnSave":true,"overrides":{},"keybindings":{"workbench.settings":"Mod-Alt-s","editor.definition":"Mod-Alt-Shift-d"}}
```
只允许 Mod-Alt-a 到 Mod-Alt-z，以及 Mod-Alt-Shift-a 到 z，但 g 保留给默认“转到行”；Mod 在 macOS 对应 Command，其余平台对应 Ctrl。不同命令不能配置相同附加键。组合输入、AltGr 和长按重复不触发。macOS 的 Option 字符转换不改变绑定，按物理 KeyA–KeyZ 位置识别；非 QWERTY 布局请按此选择。操作系统可能截获某些组合，可另选附加键。

附加键不删除或替换默认快捷键，也不是 Vim 的普通模式字符映射。删除该命令的字段或在界面选“无”即可移除附加键。编辑命令仅作用于当前获得焦点的编辑器，并保持原有语言服务、保存和版本保护。没有连接语言服务的命令不会变成假可用。

支持的命令 ID：`workbench.settings`、`workbench.catalogue`、`workbench.link`、`workbench.focus`、`workbench.notes`、`workbench.code`、`workbench.local`、`workbench.environment`、`workbench.manual`、`editor.save`、`editor.goBack`、`editor.goForward`、`editor.undo`、`editor.redo`、`editor.selectAll`、`editor.rename`、`editor.implementation`、`editor.definition`、`editor.references`、`editor.signature`、`editor.completion`、`editor.format`、`debug.toggleBreakpoint`。没有任意脚本、终端命令、自动在线提交或账号操作入口。

## 字体与语法颜色

fontFamily 可选值：""、"Intel One Mono"、"Maple Mono NF CN"、"Maple Mono CN"、"JetBrains Mono"、"Fira Code"、"Cascadia Code"、"Consolas"、"Menlo"、"SFMono-Regular"、"Noto Sans Mono CJK SC"、"monospace"。空字符串或省略使用原来的默认字体链；monospace 使用系统等宽字体。其他选项使用本机字体，未安装时自动回退，不下载字体或修改操作系统。代码、笔记编辑器和源码阅读器使用同一等宽字体设置。

colorOverrides.light / dark 现在还支持以下颜色项：
- syntaxKeyword：语法 · 关键字
- syntaxAtom：语法 · 常量字面量
- syntaxNumber：语法 · 数字
- syntaxString：语法 · 字符串
- syntaxComment：语法 · 注释
- syntaxFunction：语法 · 函数
- syntaxType：语法 · 类型
- syntaxInvalid：语法 · 无效标记
- semanticType：语言服务 · 类型
- semanticFunction：语言服务 · 函数
- semanticProperty：语言服务 · 参数与属性
- semanticNamespace：语言服务 · 命名空间
- semanticConstant：语言服务 · 常量

语法色作用于基础语法着色；语言服务返回语义分类时，由 semantic 项控制相应文字。未设置的项保留当前默认风格；重置某一项只移除该覆盖，不修改代码和其他模式配色。保存后生效，不重建编辑器或清空撤销记录。

早期内部开发配置若使用了保留的 Mod-Alt-g / Mod-Alt-Shift-g，读取时仅忽略这些绑定，其余设置保留。读取不会改写原文件；下一次显式保存仍先备份原始内容并校验版本。
