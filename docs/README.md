# browser-auto

基于 Playwright + Vercel AI SDK 的浏览器自动化 Agent。

## 当前方向（v0.1）

- 高层 API：`createBrowserAgent()` → `agent.act/close`
- 底层工具集：`createBrowserTools()`，13 个预定义工具（navigate/click/fill/press/hover/select/waitFor/screenshot/getSnapshot/getText/scroll/tabs/submitDone）
- LLM provider：DeepSeek（`@ai-sdk/openai` + `baseURL: https://api.deepseek.com`，模型默认 `deepseek-v4-flash`）
- Playwright Browser/Context/Page 管理（支持多 tab）

## 历史文档

旧设计文档（v0.1 分层记忆架构、v0.2 计划等）已归档到 [`archived/`](./archived/)，仅保留历史参考价值，不再代表当前实现方向。

## TODO

- 自循环之后需要自己管理历史消息？ 上下文过长调用接口就会报错？
  上下文压缩？

- 目前部分步骤失效后，让 Agent 分析时，它会重新分析整个页面，但是预期状态应该是让 Agent 掌握当前已经操作过的步骤，然后针对接下来的步骤进行分析（至于是否是分析整个页面， 都可？只是不需要让 Agent 再次重新刷新页面。 从头开始分析。）

- 后面流程节点编排时，支持让用户在操作节点设置预期效果校验？可行么？通过自然语言交互，让 llm 定位元素选择(高亮)（或者效果校验步骤）
  （验证失败的重试）

- 怎么直接连接用户打开的浏览器呢？用户打开的网址(浏览器插件？对话操作系统？)

- 缓存 key 的语义匹配

- 目前只是内存记忆，后续可以扩展到 文件系统记忆

- 缓存的最小成功路径算法调整。（现在是 think2execute; 是否需要是 plan2exe）

- 切换成原生 cdp

- [cdp-migration-todo](./cdp-migration-todo.md)
