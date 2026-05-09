# Proposal: 自建 Agent 循环 + 操作路径缓存

## Summary

将当前基于 `ai` SDK `generateText` 的黑盒 Agent 循环替换为自建循环，并在循环外层构建操作路径缓存层。核心目标：让重复任务跳过 LLM 调用，直接 replay 已验证的最小操作路径，并在路径部分失效时支持断点续传式 fallback。

## Motivation

当前 `BrowserAgent.act()` 使用 `ai` SDK 的 `generateText` 驱动整个多步工具调用循环。该模式在概念验证阶段工作良好，但在实际使用中暴露出以下瓶颈：

1. **重复任务无法避免 LLM 调用**：每次 `act('登录 GitHub')` 都重新走完整推理流程，消耗 token 且延迟高。
2. **黑盒循环无法插入自定义逻辑**：`generateText` 内部管理消息历史、工具调用解析、终止判断，调用方只能在 `onStepFinish` 等 hook 中被动观察，无法主动干预。
3. **没有路径复用机制**：成功的操作序列散落在 trace 中，无法被提取、存储、replay。

## Scope

### In Scope

- 替换 `generateText` 为自建 Agent 循环（直接调用 LLM API，手动管理消息、工具调用、终止条件）
- 构建缓存层：从成功的 trace 中提取最小操作路径，按指令指纹索引
- 实现带检查点的路径 replay：部分步骤失效时，已成功的步骤保留，从失效点让 LLM 接管
- 选择器弹性 fallback：首选选择器失效时，尝试预装备用选择器和简单启发式匹配
- trace 提取最小路径的过滤算法（保守策略：trace 含失败则不缓存）

### Out of Scope

- 语义级缓存匹配（embedding 相似度）—— 保留接口，先用精确指令匹配
- 复杂的 a11y-tree / CV 弹性匹配 —— L1/L2 fallback 足够
- DSL 语法设计和 parser —— 保留想法，先用 JSON 数据结构
- 跨任务/跨页面的元素级知识复用

## Non-goals

- 不追求一次性替换所有模型 provider。自建循环先支持 DeepSeek（当前唯一使用的模型），接口预留扩展。
- 不追求 100% 的缓存命中率。缓存 miss 时正常走 LLM，不影响功能正确性。

## Related Specs

- `browser-agent` —— 核心 Agent 行为定义
- `operation-trace` —— trace 数据结构，作为缓存提取的原材料
