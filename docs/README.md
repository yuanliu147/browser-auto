# browser-auto

基于 Playwright + Vercel AI SDK 的浏览器自动化 Agent。

## 当前方向（v0.1）

- 高层 API：`createBrowserAgent()` → `agent.act/close`
- 底层工具集：`createBrowserTools()`，13 个预定义工具（navigate/click/fill/press/hover/select/waitFor/screenshot/getSnapshot/getText/scroll/tabs/submitDone）
- LLM provider：DeepSeek（`@ai-sdk/openai` + `baseURL: https://api.deepseek.com`，模型默认 `deepseek-v4-flash`）
- Playwright Browser/Context/Page 管理（支持多 tab）

## 历史文档

旧设计文档（v0.1 分层记忆架构、v0.2 计划等）已归档到 [`archived/`](./archived/)，仅保留历史参考价值，不再代表当前实现方向。
