## 1. 自建 Agent 循环核心

- [x] 1.1 创建 `LLMProvider` 接口，封装 DeepSeek chat completions API（OpenAI 兼容协议，支持 function calling）
- [x] 1.2 创建 `AgentLoop` 类，实现消息历史管理、工具调用解析、终止判断（maxSteps / submitDone）
- [x] 1.3 替换 `BrowserAgent.act()` 中的 `generateText` 调用为 `AgentLoop.run()`，保持 API 不变
- [x] 1.4 移除 `ai` SDK 相关依赖（`ai`, `@ai-sdk/deepseek`, `@ai-sdk/openai`, `@ai-sdk/anthropic`）
- [x] 1.5 回归验证：现有 examples 无需修改即可正常运行

## 2. TraceRecorder 适配

- [x] 2.1 定义自建循环的事件类型 `LoopStepEvent`、`ToolCallStartEvent`、`ToolCallFinishEvent`
- [x] 2.2 重构 `TraceRecorder`，从接受 `ai` SDK 事件类型改为接受自建循环事件类型
- [x] 2.3 保持 `trace.json` / `log.txt` / 截图的输出格式不变

## 3. 缓存基础设施

- [x] 3.1 定义 `CacheKey` 接口和 `ExactKey` 实现（精确指令匹配）
- [x] 3.2 定义 `PathCache` 接口和 `MemoryPathCache` 实现
- [x] 3.3 实现 `fingerprint()` 函数（字符串规范化，预留语义指纹扩展点）
- [x] 3.4 定义 `CachedPath` / `PathStep` 类型（含 `selectorFallbacks` 和 `semanticHint`）

## 4. 路径提取

- [x] 4.1 实现工具分类常量（`EXPLORATORY_TOOLS` / `EXECUTION_TOOLS`）
- [x] 4.2 实现 `PathExtractor.extract(trace)`：保守策略——含失败步骤不提取、结尾无 submitDone 不提取、跳过探索性工具
- [x] 4.3 在 `BrowserAgent.act()` 成功执行后，自动调用提取并写入缓存

## 5. 路径 Replay

- [x] 5.1 实现 `PathReplayer.replay(path)` 检查点机制：逐步执行、记录检查点
- [x] 5.2 实现 replay 结果分类：`success` / `partial`（recoverable failure）/ `failed`（structural failure）
- [x] 5.3 在 `BrowserAgent.act()` 外层集成缓存查询和 replay 逻辑：命中则 replay，成功直接返回
- [x] 5.4 replay `partial` 时，构造消息让 `AgentLoop` 从断点继续执行
- [x] 5.5 replay `failed`（structural）时，清除缓存并走 LLM 从头开始

## 6. 弹性匹配

- [x] 6.1 实现 L1 fallback：依次尝试 `args.selector` + `selectorFallbacks[]`
- [x] 6.2 实现 L2 fallback：使用 Playwright 内置策略 `getByLabel` / `getByPlaceholder` / `getByText`
- [x] 6.3 fallback 成功时返回 `updatedSelector`，触发缓存自愈更新
- [x] 6.4 实现 `classifyFailure()`：区分 recoverable（元素定位失败但页面结构对）和 structural（URL/标题/landmark 完全不对）

## 7. LLM 接管消息构建

- [x] 7.1 实现 `buildHandoverMessages()`：system prompt + 压缩历史（已成功的执行步骤）+ 失败信息 + 当前页面状态
- [x] 7.2 `AgentLoop` 支持从已有 messages 数组继续（非空初始化）
- [ ] 7.3 重构 handover 消息：XML 结构化 + 提示词工程优化（完整路径地图、明确决策分支、约束独立成块）
- [ ] 7.4 验证 handover 性能：第二次运行耗时和 token 消耗应优于首次执行

## 8. 集成测试

- [x] 8.1 编写可重复执行的端到端 example（如打开固定页面并执行固定操作）
- [x] 8.2 验证：首次执行走 LLM，成功后缓存有路径
- [x] 8.3 验证：第二次执行缓存命中，无 LLM 调用，replay 成功
- [x] 8.4 验证：修改页面 DOM 后第三次执行，replay 部分失败 → LLM 接管 → 成功 → 缓存更新
- [ ] 8.5 验证 handover 性能：第三次执行耗时和 token 应优于首次执行
