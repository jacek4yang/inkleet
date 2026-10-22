# 编辑器设置与 JSON

设置中的“可视化”和“JSON”编辑同一份草稿。只有保存成功后才生效。JSON 是严格 JSON，不支持注释、尾逗号、重复键或未知字段；限制为 4096 UTF-8 字节。

- [完整默认示例](editor-settings.example.json)
- [JSON Schema](editor-settings.schema.json)

给其他 AI 的要求：生成符合以上 Schema 的 InkLeet 设置对象，不要输出 VS Code 或 Zed 的配置，不要写 revision、账号、密码或任意命令。vim 默认 false。将返回内容粘贴到设置 JSON 中，检查校验结果后保存。

保存使用打开草稿时的文件版本校验，保留上一份有效文件备份。外部程序修改配置后，旧草稿不能覆盖新文件。可以导出草稿，再明确重新读取；失败不会自动清空草稿。

新字段均可省略，旧 version:1 配置继续有效。主题/字体/行高作用于代码、笔记和源码阅读器；wordWrap 改变代码显示而不修改文件内容；笔记仍自动换行。下载代理属于独立设置文件，不在此 JSON 中。

主题提供浅色、深色和跟随系统。可选 colorOverrides 对象分别保存 light / dark 模式的颜色覆盖；未填写的颜色继承原有配色，不会把一套颜色自动复制到另一模式。自定义配色控件与 JSON 共用草稿，保存后生效。

允许的颜色键：surface（窗口背景）、editor（编辑区背景）、side（侧栏）、ink（正文）、muted（次要文字）、line（分隔线）、hover（悬停）、accent（强调色及普通光标）、selection（选区）、active（当前行）、cursor（Vim 块状光标）。只接受 #RRGGBB 六位十六进制，不接受 CSS 表达式、URL、变量或其他键。任意语法高亮色与任意键位映射尚未接入。

[自定义配色示例](editor-settings.colors.example.json) 可以直接粘贴。自选颜色可能降低对比度，保存前请检查前景/背景搭配；“恢复此颜色”只删除当前模式的当前项，行右侧重置删除全部颜色覆盖。切换主题本身不会删除颜色配置。
