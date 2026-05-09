## Why

当前 `BrowserAgent` 使用 `ai` SDK 的 `generateText` 驱动整个多步工具调用循环。该模式在概念验证阶段工作良好，但在实际使用中暴露出关键瓶颈：**重复任务无法避免 LLM 调用**（每次 `act('登录 GitHub')` 都重新走完整推理），且 `generateText` 的封闭循环架构无法在工具执行前后插入自定义逻辑（缓存查询、弹性匹配、断点续传），严重限制了系统的可优化空间。

## What Changes

- **自建 Agent 循环**：替换 `ai` SDK `generateText` 为手动管理的循环，直接调用 LLM API，自主控制消息历史、工具调用解析、终止判断
- **操作路径缓存层**：`act()` 执行前查询缓存，命中成功的操作路径则直接 replay，跳过 LLM 调用
- **Trace 提取最小路径**：从成功的 trace 中过滤探索性步骤，提取可复用的确定性操作序列写入缓存
- **带检查点的 Replay**：缓存命中时逐步骤执行，记录检查点；单步失败时保留已成功的步骤，从失效点让 LLM 接管继续
- **选择器弹性匹配**：首选选择器失效时，尝试备用选择器和 Playwright 内置定位策略（getByLabel/getByText），成功后自愈更新缓存
- **TraceRecorder 适配**：事件源从 `ai` SDK hooks 迁移到自建循环的内部事件，保持输出格式不变

## Capabilities

### New Capabilities

- `agent-cache-loop`: Agent 执行缓存与路径复用。系统 SHALL 支持从成功的执行轨迹中提取最小操作路径并缓存，后续相同指令 SHALL 能够直接 replay 缓存路径，并在部分失效时支持断点续传式 fallback。

### Modified Capabilities

- `browser-agent`: Agent 循环驱动方式变更。系统 SHALL 使用自建循环替代 `ai` SDK `generateText`，保持 `agent.act(instruction)` API 不变，行为等价。

## Impact

- `packages/core/src/agent.ts` —— 替换循环实现
- `packages/core/src/llm/` —— 新增/修改 LLM provider 封装
- `packages/core/src/loop/` —— 新增自建循环模块
- `packages/core/src/cache/` —— 新增缓存层模块
- `packages/core/src/logger/recorder.ts` —— 适配新的事件源
- 移除 `ai` SDK 依赖（`ai`, `@ai-sdk/deepseek` 等）
