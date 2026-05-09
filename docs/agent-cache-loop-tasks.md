# Tasks: 自建 Agent 循环 + 操作路径缓存

## Task 1: 自建 Agent 循环核心实现

**目标**：替换 `ai` SDK `generateText`，实现手动管理的 Agent 循环。

**变更范围**：

- `packages/core/src/agent.ts` —— 替换 `BrowserAgent.act()` 内部循环
- 新增 `packages/core/src/loop/` 目录 —— 循环相关代码

**实现细节**：

1. 创建 `LLMProvider` 接口，封装 DeepSeek API 调用（chat completions）
2. 创建 `AgentLoop` 类，实现消息历史管理、工具调用解析、终止判断
3. 工具调用解析支持 function calling JSON schema（与当前兼容）
4. `BrowserAgent.act()` 改用 `AgentLoop`，行为保持不变

**验证标准**：

- 现有 examples 无需修改即可正常运行
- trace 记录内容格式与之前一致
- 多次执行同一指令，行为稳定

---

## Task 2: 适配 TraceRecorder 到自建循环

**目标**：`TraceRecorder` 不再依赖 `ai` SDK 的事件类型，改为自建循环的内部事件。

**变更范围**：

- `packages/core/src/logger/recorder.ts`
- `packages/core/src/logger/types.ts`

**实现细节**：

1. 定义自建循环的事件类型：`LoopStepEvent`, `ToolCallStartEvent`, `ToolCallFinishEvent`
2. `TraceRecorder` 改为接受自建循环的事件
3. 保持 `trace.json` / `log.txt` 输出格式不变

**验证标准**：

- 执行后 traces 目录生成内容与之前一致
- TypeScript 编译通过

---

## Task 3: 缓存层基础设施

**目标**：实现路径缓存的接口、内存存储、指令指纹。

**变更范围**：

- 新增 `packages/core/src/cache/` 目录

**实现细节**：

1. `CacheKey` 接口 + `ExactKey` 实现（精确指令匹配）
2. `PathCache` 接口 + `MemoryPathCache` 实现（内存 Map）
3. `fingerprint()` 函数：当前实现为字符串规范化（去空格/小写），预留语义指纹扩展点
4. `CachedPath` 类型定义

**验证标准**：

- 缓存 set/get/invalidate 正常工作
- 单元测试覆盖基本操作

---

## Task 4: 从 Trace 提取最小路径

**目标**：实现 `PathExtractor`，从成功的 trace 中过滤出可缓存的操作序列。

**变更范围**：

- 新增 `packages/core/src/cache/extractor.ts`

**实现细节**：

1. 定义工具分类常量（EXPLORATORY_TOOLS / EXECUTION_TOOLS）
2. 实现保守策略：
   - trace 含任何失败步骤 → 不提取
   - 最后一步不含 submitDone → 不提取
   - 跳过探索性工具（getSnapshot, screenshot, getText）
3. 提取选择器备用项和语义提示（从 trace 的截图前后状态推断，v1 可简化）
4. `BrowserAgent.act()` 执行成功后，自动调用提取并写入缓存

**验证标准**：

- 成功 trace → 缓存中出现对应路径
- 含失败的 trace → 不进入缓存
- 探索性工具不在缓存路径中

---

## Task 5: 带检查点的路径 Replay

**目标**：`act()` 执行前查询缓存，命中则 replay；支持断点续传。

**变更范围**：

- `packages/core/src/cache/replayer.ts`（新增）
- `packages/core/src/agent.ts`（修改）

**实现细节**：

1. `PathReplayer.replay(path)` 实现检查点机制
2. 每步执行成功 → 记录检查点
3. 单步失败 → 返回 `partial` 状态（已完成步骤 + 剩余步骤 + 当前状态）
4. `BrowserAgent.act()` 外层逻辑：
   - 查询缓存
   - 命中 → replay
   - replay 成功 → 直接返回
   - replay 部分成功 → LLM 接管（从断点开始）
   - replay 结构性失败 → 清除缓存，走 LLM 从头开始
   - 未命中 → 走 LLM，成功后提取路径写入缓存

**验证标准**：

- 缓存命中时，无 LLM 调用（可通过日志或 mock 验证）
- 部分 replay 失败后，LLM 接管时能正确继续
- 结构性失败后，缓存被清除

---

## Task 6: 弹性匹配实现

**目标**：选择器失效时，尝试备用策略定位元素。

**变更范围**：

- `packages/core/src/cache/replayer.ts`（增强 executeWithFallback）

**实现细节**：

1. L1：依次尝试 `args.selector` + `selectorFallbacks[]`
2. L2：使用 Playwright 内置策略 `getByLabel`, `getByPlaceholder`, `getByText`
3. 备用策略成功时，返回 `updatedSelector`，触发缓存自愈
4. 全部失败时，调用 `classifyFailure()` 判断是 recoverable 还是 structural

**验证标准**：

- 改变页面元素的 class/id，replay 仍能成功
- 成功后缓存中的选择器被更新为命中项
- 页面结构完全变化时，正确标记为 structural_failure

---

## Task 7: LLM 接管时的消息构建

**目标**：replay 部分失败后，构建消息让 LLM 从断点继续。

**变更范围**：

- `packages/core/src/loop/` 目录

**实现细节**：

1. `buildHandoverMessages()` 函数：
   - system prompt
   - 压缩历史：已成功的步骤（assistant tool call + tool result）
   - 失败信息：哪一步、什么选择器、什么错误
   - 当前页面状态（getSnapshot 或简化描述）
2. `AgentLoop` 支持从已有 messages 数组继续（非空初始化）

**验证标准**：

- replay 失败后，LLM 能看到"已完成什么 + 当前状态 + 下一步该做什么"
- LLM 不会重复已完成的操作

---

## Task 8: 集成测试与示例

**目标**：验证整套流程端到端工作。

**变更范围**：

- `examples/` 或新增测试

**实现细节**：

1. 写一个可重复执行的 example（如"打开 example.com 并点击某个链接"）
2. 第一次执行：走 LLM，成功，提取路径到缓存
3. 第二次执行：缓存命中，无 LLM 调用，replay 成功
4. 修改页面（手动改 HTML），第三次执行：replay 部分失败 → LLM 接管 → 成功 → 缓存更新

**验证标准**：

- 三次执行全部成功
- 第二次 LLM API 未被调用（可通过日志或拦截验证）
- 第三次有 LLM 调用但任务完成
