# 六语言模板与源码边界适配方案

状态：设计与分项修复中。当前支持 Python、Rust、Go、C、C++、Java。
核查基线：f25d6ccb4f0312d555a4aab3c3625b157cbdbc5a。
本报告不声称六语言已与中国站在线执行环境完全一致。

## 不变量
1. 官方模板来自中国站题目 GraphQL 的 codeSnippets，以 langSlug 精确选择。记录来源、题目 ID、语言与抓取版本。新解答使用原文；刷新绝不覆盖已有解答。
2. 用户源码是唯一持久化、导出与提交正文。导入、注释、Unicode、行尾、末尾换行都保留。提交 typed_code 必须逐字等于确认时冻结的源码快照。
3. LSP 支持代码和本地测试入口属于临时派生文件。不得写回解答，不得混入正式提交。标注有效映射范围，拒绝来自辅助区的 Rename/编辑。
4. 每种语言各有适配器，配置、签名约束和支持类型共享；不以字符串拼接同一规则处理全部语言。
5. 编译器版本、edition/标准、默认导入与可用第三方库必须有独立中国站证据。国际站资料只能作参考，不能冒充中国站已验证配置。

## 各语言要求
- Rust：保留 use、别名、组合导入、完全限定路径；不默认注入 HashMap。统一 LSP/运行器的 Solution、ListNode、TreeNode 冲突处理，节点内部使用完全限定 std 路径。检查借用/可变引用、泛型、关键字函数名、crate 属性与 include 上下文。LSP 和编译器 edition 必须一致。
- Python：显式 import/from import 原样执行；future import 与模块文档字符串位置合法。运行器提供的默认名称必须与编辑器一致且可追溯，节点构造/序列化与异常栈映射必须一致。不得在运行前改写用户 import。
- Java：保留 import/package 的相对顺序，解析官方类/方法签名；处理静态与实例调用、ListNode/TreeNode、泛型集合与编译诊断行映射。自定义 package 的本地支持必须明确，不能在 package 前插普通 import。
- C++：保留 include、namespace、别名与模板；头文件和语言标准与已验证环境匹配。节点定义去重需同时顾及用户翻译单元和驱动翻译单元。
- C：保留 include、typedef 与真实 C 编译路径；签名中的指针、返回长度、二维列长度和所有权要显式适配。驱动用 C++ 并不意味着用户 C 源码可按 C++ 编译。辅助结构定义不能靠粗暴删除解决重复。
- Go：保留 package/import，函数名与官方签名一致；固定 go.mod 与可用依赖。包级节点声明跨文件可共享，但 import 按文件生效，不能把驱动 import 当成用户源码的 import。

## 已核实行为与缺口
- 默认模板已从官方 codeSnippets 读取；未找到语言模板时当前退化为空字符串，需要改为明确的不可用状态。
- judge_transport 当前 typed_code 直接等于 snapshot.code，显式导入不会被删除。
- Rust HashMap 不属于语言标准 prelude，应写显式导入或完全限定路径。
- Rust LSP 避开已有辅助类型，运行器原先无条件定义，存在重复声明差异。
- Rust 本地/LSP 当前为 edition 2021；中国站版本未核实，不能直接改成国际站文档里的 2024。
- Python 运行默认名称多于 LSP，Java 运行包含 java.io 而 LSP 没有；需明确并统一当前支持规则。
- 自定义节点、设计类、特殊交互接口及第三方 crate 不得笼统声称已支持。

## 验收
每种语言单独记录：官方模板相等；标准库显式导入；未导入名称的诊断；普通题、多参数、数组/二维数组、链表、树、原地修改；非法签名；代码与辅助定义冲突；编辑/运行/调试坐标一致；提交序列化正文相等。
Rust 另测 HashMap 普通/别名/组合/完全限定导入，Rc/RefCell，leading inner attributes。
命名解答之间不共享源码、运行归属、断点或编辑状态；原默认文件无覆盖迁移。
浏览器模拟、真实编译、Linux 原生 GUI、中国站在线评测分别记结果。未真实提交的项目保持未验证。
不为了通过测试删除现有有效断言，不执行自动提交。

## 参考
- Rust Book HashMap：https://doc.rust-lang.org/book/ch08-03-hash-maps.html
- Rust prelude：https://doc.rust-lang.org/std/prelude/
- LeetCode 国际站环境资料（不是中国站确认）：https://support.leetcode.com/hc/en-us/articles/360011833974-What-are-the-environments-for-the-programming-languages
- 中国站帮助中心：https://leetcode.cn/help-center/
