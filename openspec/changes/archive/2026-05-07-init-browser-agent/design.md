## Context

从零构建基于 Playwright + AI SDK 的浏览器自动化 Agent。废弃旧 v0.1 分层记忆架构，采用 Agent Loop（工具调用）模式。

## Goals / Non-Goals

**Goals:**

- 实现 `createBrowserAgent()` 高层 API，v0.1 仅暴露 `act`（extract/observe 后续版本添加）
- `llm.apiKey` 默认读取 `process.env.DEEPSEEK_API_KEY`，不强制依赖 dotenv（由用户项目自行加载）
- 实现 13 个浏览器工具，通过 AI SDK `generateText` + `tools` 驱动
- 支持 DeepSeek 模型（`deepseek-v4-flash`）通过 OpenAI 兼容协议调用
- 支持多 page/tab 管理

**Non-Goals:**

- 不实现分层记忆（L3/L2/L1）—— 旧 v0.1 设计已废弃
- 不实现 Trace 系统完整版 —— v0.1 仅做简单 console 日志
- 不实现重试/并发锁 —— 留到 v0.2
- 不实现 Daemon / 远程服务 —— v0.5 规划
- 不支持非 DeepSeek 模型 —— v0.1 仅支持 DeepSeek，架构预留扩展

## Decisions

| 决策              | 选择                                         | 备选                            | 理由                                                |
| ----------------- | -------------------------------------------- | ------------------------------- | --------------------------------------------------- |
| LLM SDK           | `ai` + `@ai-sdk/openai`                      | 直接调 DeepSeek HTTP API        | AI SDK 提供统一的 tool use 抽象，后续扩展模型成本低 |
| DeepSeek 接入方式 | `@ai-sdk/openai` + `baseURL`                 | `@ai-sdk/deepseek`（不存在）    | DeepSeek 提供 OpenAI 兼容协议，复用现有 provider    |
| 模型              | 默认 `deepseek-v4-flash`，`model` 字段可覆盖 | 硬编码                          | 用户可能换 DeepSeek 其他模型，架构预留扩展          |
| 工具粒度          | 13 个预定义工具                              | 纯代码生成（bash/JS）           | 预定义工具可控、错误明确、调试简单                  |
| 多 page 管理      | 隐式 current page + `tabs` 工具              | 显式 tabId 参数                 | 匹配人类心智，工具签名简洁                          |
| extract 实现      | `submitDone` tool 带结果                     | 双阶段（浏览 + generateObject） | 一次 LLM 循环，简洁                                 |
| 错误处理          | 抛异常                                       | Result 类型                     | 符合 Node.js 习惯，简单                             |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  用户代码                                                    │
│  createBrowserAgent({ browser, llm })                       │
│    → agent.act("登录")                                      │
│    → agent.extract({ schema })                              │
│    → agent.observe("按钮")                                  │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  BrowserAgent 类                                             │
│  ├─ 持有 Playwright Browser + Context                       │
│  ├─ 维护 currentPage（多 tab）                              │
│  ├─ 持有 LLM model（DeepSeek adapter）                      │
│  └─ act 触发独立 generateText loop                          │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  AI SDK generateText({                                       │
│    model: deepseek(llm.model ?? 'deepseek-v4-flash'),       │
│    tools: { navigate, click, fill, press, hover,            │
│             select, waitFor, screenshot, getSnapshot,       │
│             getText, scroll, tabs, submitDone },            │
│    maxSteps: 50                                             │
│  })                                                          │
└─────────────────────────────────────────────────────────────┘
```

## 工具清单（13 个）

| #   | 工具          | 参数                                                                | 说明                                       |
| --- | ------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| 1   | `navigate`    | `url: string`                                                       | 跳转 URL                                   |
| 2   | `click`       | `selector?: string, text?: string`                                  | 点击元素（CSS selector 或可见文本）        |
| 3   | `fill`        | `selector?: string, text?: string, value: string`                   | 在输入框填入文本                           |
| 4   | `press`       | `key: string`                                                       | 按键（Enter/Escape/Tab 等）                |
| 5   | `hover`       | `selector?: string, text?: string`                                  | 悬停元素                                   |
| 6   | `select`      | `selector?: string, text?: string, value: string`                   | 下拉选择                                   |
| 7   | `waitFor`     | `selector?: string, ms?: number, state?: string`                    | 等待元素或固定时间                         |
| 8   | `screenshot`  | 无                                                                  | 截图并返回 base64                          |
| 9   | `getSnapshot` | 无                                                                  | 获取页面结构化快照（a11y tree / DOM 摘要） |
| 10  | `getText`     | `selector?: string, text?: string`                                  | 获取指定元素文本                           |
| 11  | `scroll`      | `direction: 'up' \| 'down', amount?: number`                        | 滚动页面                                   |
| 12  | `tabs`        | `action: 'list' \| 'switch' \| 'new', url?: string, index?: number` | Tab 管理                                   |
| 13  | `submitDone`  | `result?: any`                                                      | Agent 完成任务，提交结果                   |

## 目录结构

```
packages/core/src/
├── index.ts              # 导出 createBrowserAgent, createBrowserTools
├── agent.ts              # BrowserAgent 类
├── types.ts              # 公共类型（AgentOptions, ActOptions, ExtractOptions...）
├── llm/
│   └── index.ts          # createDeepSeekModel() —— ai-sdk adapter
├── browser/
│   ├── index.ts          # createBrowserContext() —— Browser/Context 管理
│   └── page.ts           # Page 管理 + currentPage 跟踪
├── tools/
│   ├── index.ts          # createBrowserTools() —— 组装 13 个工具
│   ├── navigate.ts
│   ├── click.ts
│   ├── fill.ts
│   ├── press.ts
│   ├── hover.ts
│   ├── select.ts
│   ├── wait.ts
│   ├── screenshot.ts
│   ├── snapshot.ts
│   ├── get-text.ts
│   ├── scroll.ts
│   ├── tabs.ts
│   └── done.ts
└── trace.ts              # 简单 console trace（可选）
```

## Risks / Trade-offs

- **[Risk]** DeepSeek tool calling 稳定性不如 Claude/OpenAI → **Mitigation**: ai-sdk 有 `experimental_repairToolCall` 容错；在 tool execute 层加 try/catch 包装错误返回给 LLM
- **[Risk]** `getSnapshot` 返回的 DOM 摘要过大，token 消耗高 → **Mitigation**: v0.1 先用精简版 a11y tree；v0.3 再考虑子树裁剪
- **[Risk]** 多 page 场景下 LLM 忘记切换 tab → **Mitigation**: system prompt 强调"新页面打开后 active page 自动切换"；`tabs` 工具返回当前 active tab 信息
- **[Risk]** `screenshot` 工具给纯文本模型喂 base64 无意义 → **Mitigation**: v0.1 中 screenshot 主要做调试/trace，不依赖 LLM "看懂"图片；如需视觉理解留到后续多模态版本
