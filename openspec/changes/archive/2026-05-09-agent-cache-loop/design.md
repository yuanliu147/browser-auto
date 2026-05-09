## Context

当前 `BrowserAgent` 基于 `ai` SDK 的 `generateText` 实现。`generateText` 是一个高层封装：调用方提供 model、tools、prompt，SDK 内部管理完整的 while 循环——调用 LLM、解析工具调用、执行工具、构建消息历史、判断终止条件。调用方只能在 `onStepFinish`、`onToolCallStart` 等 hook 中被动观察，无法主动干预循环逻辑。

该模式在验证阶段工作良好，但随着功能演进，以下需求无法在现有架构中实现：

- 重复任务跳过 LLM 调用（缓存层需要在循环开始前查询，在工具执行前决策）
- 选择器失效时的弹性 fallback（需要在单个工具执行前插入重试逻辑）
- 部分路径 replay 失败后的断点续传（需要精确控制消息历史的断点拼接）

## Goals / Non-Goals

**Goals:**

- 自建 Agent 循环替代 `ai` SDK `generateText`，保持 `agent.act()` API 不变
- 从成功的 trace 中提取最小操作路径并缓存
- 相同指令再次执行时，优先 replay 缓存路径，跳过 LLM 调用
- 缓存路径部分失效时，保留已成功的检查点，从失效点让 LLM 接管
- 选择器失效时尝试备用策略定位元素，成功后自愈更新缓存

**Non-Goals:**

- 语义级缓存匹配（embedding 相似度）—— 保留接口，先用精确指令匹配
- 复杂的 a11y-tree / CV 弹性匹配 —— L1/L2 fallback 足够
- DSL 语法设计和 parser —— 保留想法，先用 JSON 数据结构
- 流式输出 —— 当前不需要
- 一次性支持多个 LLM provider —— 先支持 DeepSeek，接口预留扩展

## Decisions

### Decision 1: 自建循环替代 `ai` SDK `generateText`

**选择**：直接调用 LLM API，手动管理消息历史、工具调用解析、终止判断。

**替代方案**：保留 `generateText`，在 `act()` 外层包缓存层（命中 replay，不命中走 `generateText`）。

**拒绝原因**：外层包缓存只能做"全有或全无"的 replay。一旦 replay 中某步失败，没有机制让 LLM 从断点接管（因为 `generateText` 不接受中途状态的消息历史）。且外层包无法干预工具执行过程（如选择器 fallback），弹性匹配必须在工具函数内部硬编码，与缓存层解耦。

**风险**：增加约 60-80 行核心循环代码，需要自行处理工具调用解析。但解析逻辑只是从 assistant message 中提取 JSON，复杂度可控。

### Decision 2: 消息格式沿用 function calling schema

**选择**：保持与 `ai` SDK 兼容的 function calling JSON 格式，不引入 XML 等自定义格式。

**理由**：减少模型适配成本，DeepSeek 原生支持 OpenAI 兼容的 function calling。若未来需要更复杂的格式（如一个回复中混合 reasoning + 多个 tool call 的精确边界控制），再评估迁移到 XML。

### Decision 3: 保守路径提取策略

**选择**：trace 中包含任何失败步骤，整段不进入缓存。

**理由**：包含弯路的 trace 的"确定性"不够高，缓存价值可能不大。且弯路识别（区分探索性失败 vs 执行性失败）容易过度设计。保守策略在第一阶段足够，后续根据实际数据再优化。

### Decision 4: 检查点式 replay + LLM 接管

**选择**：replay 逐步执行，记录检查点；单步失败时返回已完成步骤 + 当前状态，构造消息让 LLM 从断点继续。

**替代方案**：replay 失败时整体重来（从头走 LLM）。

**拒绝原因**：已成功的步骤（如已填写的表单）在页面上已经产生了副作用。整体重来意味着 LLM 需要重新执行这些步骤，既浪费 token 又可能出错（比如重复提交表单）。断点续传让 LLM 看到"已完成 X，现在遇到 Y 的问题"，上下文更精准。

### Decision 5: 弹性匹配仅到 L2（Playwright 内置策略）

**选择**：L1（备用选择器数组）+ L2（`getByLabel`/`getByPlaceholder`/`getByText`）。不做 a11y-tree 解析或 CV 定位。

**理由**：L1/L2 实现简单，覆盖 85% 以上的"选择器因 class/id 变化而失效"场景。L3（a11y tree）需要额外解析逻辑且 token 成本高；L4（CV）延迟高。如果页面变化到 L2 都找不到元素，大概率整个流程结构已变，不如让 LLM 重新分析。

## Risks / Trade-offs

| Risk                                                | Mitigation                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| 自建循环引入的 bug 导致行为与 `generateText` 不一致 | Task 1 完成后，用现有 examples 做回归验证，确保输出等价                |
| 缓存命中率过低，投入产出不成正比                    | 先实现内存缓存 + 保守提取，运行实际任务收集命中率数据，再决定优化方向  |
| 缓存中的选择器随页面变化逐渐全部失效                | L2 fallback + 自愈更新机制；structural failure 时自动清除缓存          |
| 消息历史过长导致 LLM token 超限                     | 断点续传时只压缩保留已成功的执行步骤（不含 exploration），通常 < 20 步 |
| 移除 `ai` SDK 后失去多 provider 统一接口            | `LLMProvider` 接口预留扩展，未来添加 provider 只需实现同一接口         |
