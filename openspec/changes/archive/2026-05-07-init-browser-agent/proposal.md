## Why

项目当前仅有空壳代码（`packages/core/src/index.ts` 为 hello-world），而 `docs/v0.1/`、`docs/v0.2/` 中的分层记忆架构与当前需求方向不符。需要从零实现一个基于 Playwright + Vercel AI SDK 的浏览器自动化 Agent，以工具调用（tool use）方式驱动 LLM 完成浏览器操作。

## What Changes

- 废弃/归档 `docs/v0.1/`、`docs/v0.2/` 中的旧设计文档
- 在 `packages/core/` 中实现浏览器自动化 Agent：
  - 高层 API：`createBrowserAgent()` → `agent.act/close`（v0.1 仅 act，extract/observe 后续版本）
  - 底层工具集：`createBrowserTools()` 供自定义 loop 使用
  - 13 个预定义浏览器工具（navigate/click/fill/press/hover/select/waitFor/screenshot/getSnapshot/getText/scroll/tabs/submitDone）
  - LLM provider 封装：DeepSeek（`@ai-sdk/openai` + `baseURL: https://api.deepseek.com`，模型 `deepseek-v4-flash`）
  - Playwright Browser/Context/Page 管理（支持多 page）
- 新增核心依赖：`ai`、`@ai-sdk/openai`、`playwright`、`zod`

## Capabilities

### New Capabilities

- `browser-agent`: 基于工具调用的浏览器自动化 Agent，支持语义级 act/extract/observe API

### Modified Capabilities

- 无（新项目，无既有 spec）

## Impact

- `packages/core/src/` 全部重写
- `packages/core/package.json` 新增运行时依赖
- `docs/v0.1/`、`docs/v0.2/` 相关文档归档到 `docs/archived/`
- 根目录 `package.json` 不受影响
