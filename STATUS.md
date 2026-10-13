# 墨题开发状态

当前处于阶段 B 的早期实现；不能作为日常刷题客户端发布。

## 已验证
- Public 仓库与 GitHub 网页登录账号 jacek4yang。
- main 检查点 9cfe8674f365b098cd54e060ad620c81e10c1f54。
- 最小 CI 成功：https://github.com/jacek4yang/inkleet/actions/runs/38420492176
- 检查点 Artifact 已生成；开发浏览器下载超时，未确认下载完成。
- 网页提交、创建分支和 Draft PR #1；Secrets 管理入口可访问。
- PR 合并、Release 资产上传、签名密钥保管尚未实测。

## 已实现，验证中
- 六语言独立草稿领域模型、不可变评测快照、重复提交门闩。
- 外部文本冲突检测规则，冲突保留双方正文。
- 响应式题目/代码/笔记页面、源码和 Markdown 导出。
- 浏览器预览使用自编题目，仅内存数据，不宣称持久化。
- 当前编辑器是基础 textarea，尚未接入 CodeMirror。
- 领域单元测试与前端构建已经接入 CI，必须检查最新 SHA 的结果。

## 未实现
中国站真实登录、题库、运行和提交；原生文件存储；Android/桌面安装包；
CodeMirror、Markdown 预览与外部编辑；本地 Runner、LSP、DAP、工具链管理。
运行/提交按钮明确禁用，不伪造评测结果。

## 下一步
完成原生代码/笔记存储，运行前端与 Rust 测试，锁定完整依赖树并提交锁文件；
提供真实前端预览截图，再验证各平台原生构建与中国站登录会话原型。

## 恢复入口
先读取 feat/first-workbench 分支最新提交、PR #1、此文件和最新 Actions 日志。
PR 尚未通过功能验收，保持 Draft。没有正式 Release。
