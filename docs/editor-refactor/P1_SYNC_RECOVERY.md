# P1：文档同步失败恢复
基线：2b6eabf05f55f2ba17bf03e510bf315285c167dc。
参考 Lithe 固定 6210013d06e1410c7bcbb1949e1ff16ea8deae15 的 pending-document-changes.ts / pending-document-changes.test.ts；设计参考，独立实现，无上游代码移植。
## 缺陷
intelligence.ts 的 synchronization.then 成功链会被一次 update_language_document 拒绝永久污染，后续补全、悬停、签名、引用/重命名及诊断都无法再次同步。
## 机制
DocumentSyncQueue 向每个调用者返回原操作的成功/失败结果，但内部队尾在两种结果下都可继续。没有新增自动重试、定时器、服务重启或轮询。sent 仅在成功后推进；版本单调递增；请求仍必须等待最新文档同步成功。
关闭/换语言后的旧队列依然由 closed/session/document 守卫禁止副作用。
## 验证
新增纯 TypeScript 顺序/拒绝/独立队列测试；真实 CodeMirror 浏览器测试中模拟一次 IPC 拒绝，再编辑并补全，核对 update 成功先于该版本 request；模拟销毁期间的延迟拒绝，禁止旧会话再发请求。
这是故障注入测试，不冒充真实服务断线。完整 Linux 原生回归单独运行。
## 待完成
此提交没有实现 Snippet；当前 initialize 仍为 snippetSupport:false。后续必须同步协议能力、转换与真实占位符测试，不能只删除过滤。
