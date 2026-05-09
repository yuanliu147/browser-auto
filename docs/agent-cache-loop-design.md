# Design: 自建 Agent 循环 + 操作路径缓存

## 目录

1. [技术选型：为什么不用 `ai` SDK](#1-技术选型为什么不用-ai-sdk)
2. [整体架构](#2-整体架构)
3. [自建 Agent 循环](#3-自建-agent-循环)
4. [缓存层设计](#4-缓存层设计)
5. [路径提取与过滤](#5-路径提取与过滤)
6. [Replay 与失效策略](#6-replay-与失效策略)
7. [弹性匹配](#7-弹性匹配)

---

## 1. 技术选型：为什么不用 `ai` SDK

### `ai` SDK `generateText` 的工作模式

```
┌─────────────────────────────────────────────────────────────────┐
│                    generateText 黑盒循环                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  调用方提供: model, tools, system, prompt, stopWhen              │
│                                                                  │
│  SDK 内部:                                                       │
│    while (!stop) {                                               │
│      response = await model.chat(messages)                       │
│      toolCalls = parseToolCalls(response)                        │
│      results = await executeAll(toolCalls)                       │
│      messages.push(assistantMsg, ...toolResults)                 │
│    }                                                             │
│                                                                  │
│  调用方可观测: onStepFinish, onToolCallStart/Finish, onFinish    │
│  调用方可控制: 无（除了 stopWhen 条件）                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 该模式的固有缺陷

| 缺陷                | 说明                                                         | 我们的需求如何被阻碍                                            |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| **循环控制权封闭**  | `while` 循环在 SDK 内部，调用方无法在某一步之前/之后插入逻辑 | 无法在 tool 执行前查询缓存、无法在执行失败时插入 fallback 逻辑  |
| **消息历史不可控**  | SDK 自动构建 messages 数组，调用方无法精确控制格式           | 断点续传时需要构造"部分历史 + 当前状态"的消息，SDK 不提供此能力 |
| **工具执行无 hook** | `executeAll` 是内部批量执行，调用方无法干预单个 tool         | 弹性匹配需要在 execute 前尝试备用选择器，SDK 不支持             |
| **失败处理粗粒度**  | 任何一步失败，SDK 要么重试（模型层面），要么整体退出         | 我们需要"单步失败 → 局部修复 → 继续"的细粒度控制                |
| **缓存层无插槽**    | 整个循环前后只有 onFinish，没有"执行前查询缓存"的扩展点      | 缓存必须包在 `generateText` 外层，无法融入循环内部              |

### 自建循环的复杂度评估

核心循环代码量约 60-80 行，主要工作：

1. **调用 LLM API**：直接调用 provider 的 chat completions API（与 SDK 底层相同）
2. **解析 tool calls**：从 assistant message 中提取工具调用（JSON schema 或 XML）
3. **执行工具**：调用已有的 playwright 工具函数
4. **构建消息历史**：手动追加 assistant message 和 tool result messages

| 维度                    | AI SDK `generateText` | 自建循环                      |
| ----------------------- | --------------------- | ----------------------------- |
| 多步循环                | ✅ 内置               | ~15 行代码                    |
| 工具调用解析            | ✅ 自动               | ~20 行代码                    |
| 消息历史管理            | ✅ 自动               | ~10 行代码                    |
| 流式输出                | ✅ 一行代码           | 当前不需要                    |
| 多 provider 切换        | ✅ 统一接口           | 先支持 DeepSeek，接口预留扩展 |
| **每步注入自定义逻辑**  | ❌                    | ✅ 任意位置                   |
| **缓存层集成**          | ❌ 无插槽             | ✅ 循环前后、每步前后         |
| **选择性重放/断点续传** | ❌                    | ✅                            |
| **失败时局部回退**      | ❌ 整体重来           | ✅ 单步处理                   |

**结论**：自建循环的额外代码量可控（<100 行核心逻辑），但换来的架构自由度是后续所有功能（缓存、弹性匹配、断点续传）的前提。

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              act(instruction)                             │
└────────────────────────────────────────┬─────────────────────────────────┘
                                         │
                     ┌───────────────────▼───────────────────┐
                     │           CacheLayer                  │
                     │  fingerprint(instruction) ──▶ key     │
                     │  cache.get(key) ──▶ cachedPath?       │
                     └─────────────┬─────────────────────────┘
                                   │
                     命中 ◀────────┘────────▶ 未命中
                       │                        │
                       ▼                        ▼
         ┌─────────────────────┐    ┌─────────────────────┐
         │   PathReplayer      │    │   AgentLoop (自建)  │
         │   replay(path)      │    │   调用 LLM API      │
         │   检查点 + fallback │    │   多步推理 + 执行   │
         └──────────┬──────────┘    └──────────┬──────────┘
                    │                          │
                    │                          │
         成功/部分成功              执行完成
                    │                          │
                    └──────────────┬───────────┘
                                   │
                     ┌─────────────▼──────────────┐
                     │   TraceRecorder (已有)     │
                     │   记录完整执行轨迹          │
                     └─────────────┬──────────────┘
                                   │
                     ┌─────────────▼──────────────┐
                     │   PathExtractor            │
                     │   从成功 trace 提取最小路径 │
                     │   写入 cache               │
                     └────────────────────────────┘
```

---

## 3. 自建 Agent 循环

### 核心循环

```typescript
class AgentLoop {
  private model: LLMProvider; // 封装 DeepSeek API
  private tools: ToolSet;
  private maxSteps: number;

  async run(instruction: string): Promise<LoopResult> {
    const messages: Message[] = [
      { role: "system", content: ACT_SYSTEM_PROMPT },
      { role: "user", content: instruction },
    ];

    const steps: StepResult[] = [];
    let done = false;

    while (!done && steps.length < this.maxSteps) {
      const response = await this.model.chat(messages);
      const toolCalls = parseToolCalls(response);

      if (
        toolCalls.length === 0 ||
        toolCalls.some((tc) => tc.name === "submitDone")
      ) {
        done = true;
      }

      const results = await Promise.all(
        toolCalls.map((tc) => this.executeTool(tc))
      );

      steps.push({ toolCalls, results });

      messages.push(
        { role: "assistant", content: response.content, toolCalls },
        ...results.map((r) => ({
          role: "tool" as const,
          toolCallId: r.callId,
          content: r.output,
        }))
      );
    }

    return { steps, success: done };
  }
}
```

### 消息格式

使用 function calling schema（与当前 SDK 一致），保持与模型的兼容性：

```typescript
interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  content: string;
}
```

---

## 4. 缓存层设计

### 缓存 Key

```typescript
interface CacheKey {
  equals(other: CacheKey): boolean;
  hash(): string;
}

// v1：精确指令匹配（当前实现）
class ExactKey implements CacheKey {
  constructor(private instruction: string) {}
  equals(other: ExactKey) {
    return this.instruction === other.instruction;
  }
  hash() {
    return hashString(this.instruction);
  }
}

// v2：语义匹配（预留接口，未来实现）
// class SemanticKey implements CacheKey { ... }
```

### 缓存 Value（最小路径）

```typescript
interface CachedPath {
  fingerprint: string; // 指令指纹
  createdAt: string;
  hitCount: number;

  steps: Array<{
    tool: string;
    args: Record<string, unknown>;

    // 弹性定位信息
    selectorFallbacks?: string[];
    semanticHint?: {
      tagName?: string;
      inputType?: string;
      nearText?: string;
      ariaLabel?: string;
    };
  }>;

  // 成功验证信号
  verify?: Array<{
    type: "urlContains" | "urlNotContains" | "titleContains";
    value: string;
  }>;
}
```

### 缓存存储

```typescript
interface PathCache {
  get(key: CacheKey): CachedPath | undefined;
  set(key: CacheKey, path: CachedPath): void;
  invalidate(key: CacheKey): void;
}

// v1：内存级（Map）
class MemoryPathCache implements PathCache { ... }

// v2：持久化（预留接口）
// class FileSystemPathCache implements PathCache { ... }
```

---

## 5. 路径提取与过滤

### 工具分类

```typescript
const EXPLORATORY_TOOLS = ["getSnapshot", "screenshot", "getText"];
const EXECUTION_TOOLS = [
  "navigate",
  "click",
  "fill",
  "press",
  "hover",
  "select",
  "scroll",
  "tabs",
];
```

### 保守提取策略（v1）

```typescript
function extractMinimalPath(trace: TraceData): CachedPath | null {
  // 规则 1：trace 包含任何失败步骤，不缓存
  const hasFailure = trace.steps.some((s) =>
    s.toolCalls.some((tc) => !tc.success)
  );
  if (hasFailure) return null;

  // 规则 2：提取执行性工具，跳过探索性工具
  const steps = trace.steps.flatMap((s) =>
    s.toolCalls
      .filter(
        (tc) =>
          EXECUTION_TOOLS.includes(tc.toolName) || tc.toolName === "waitFor"
      )
      .map((tc) => ({
        tool: tc.toolName,
        args: tc.args,
        selectorFallbacks: extractFallbacks(tc),
        semanticHint: extractSemanticHint(tc, trace),
      }))
  );

  // 规则 3：结尾必须是 submitDone（成功终止）
  const lastStep = trace.steps[trace.steps.length - 1];
  const hasSubmitDone = lastStep?.toolCalls.some(
    (tc) => tc.toolName === "submitDone"
  );
  if (!hasSubmitDone) return null;

  return {
    fingerprint: fingerprint(trace.instruction),
    createdAt: new Date().toISOString(),
    hitCount: 0,
    steps,
  };
}
```

---

## 6. Replay 与失效策略

### 断点续传模型

```typescript
async function replayPath(
  path: CachedPath,
  pageManager: PageManager
): Promise<ReplayResult> {
  const checkpoints: number[] = [];

  for (let i = 0; i < path.steps.length; i++) {
    const step = path.steps[i];
    const result = await executeWithFallback(step, pageManager);

    if (result.status === "success") {
      checkpoints.push(i);

      // 选择器被更新时，自愈缓存
      if (result.updatedSelector) {
        step.selectorFallbacks = step.selectorFallbacks ?? [];
        if (!step.selectorFallbacks.includes(result.updatedSelector)) {
          step.selectorFallbacks.unshift(result.updatedSelector);
        }
      }
      continue;
    }

    if (result.status === "recoverable_failure") {
      // 返回已执行的检查点 + 剩余步骤，让 LLM 接管
      return {
        status: "partial",
        completedSteps: checkpoints,
        failedAt: i,
        remainingSteps: path.steps.slice(i),
        currentState: await getCurrentState(pageManager),
      };
    }

    if (result.status === "structural_failure") {
      // 整段缓存作废
      return {
        status: "failed",
        failedAt: i,
        reason: "structural",
      };
    }
  }

  return { status: "success" };
}
```

### LLM 接管时的消息构建（选项 B：压缩历史）

```typescript
function buildHandoverMessages(
  instruction: string,
  completedSteps: PathStep[],
  failedStep: PathStep,
  error: string,
  currentSnapshot: string
): Message[] {
  return [
    { role: "system", content: ACT_SYSTEM_PROMPT },
    { role: "user", content: `Task: ${instruction}` },

    // 压缩历史：只保留已成功的执行步骤
    ...completedSteps.flatMap((step) => [
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [
          { id: generateId(), name: step.tool, arguments: step.args },
        ],
      },
      {
        role: "tool" as const,
        toolCallId: generateId(),
        content: JSON.stringify({ ok: true }),
      },
    ]),

    // 失败信息 + 当前状态
    {
      role: "user",
      content: `
The next step was supposed to ${step.tool} with ${JSON.stringify(failedStep.args)},
but it failed: ${error}

Current page state:
${currentSnapshot}

Please continue the task from the current state.
      `.trim(),
    },
  ];
}
```

---

## 7. 弹性匹配

### 策略层级

| 层级 | 策略                                                           | 实现复杂度 | 预期覆盖 |
| ---- | -------------------------------------------------------------- | ---------- | -------- |
| L1   | 首选选择器 + 预装备用选择器                                    | 低         | 70%      |
| L2   | Playwright 内置策略（getByLabel, getByPlaceholder, getByRole） | 低         | 15%      |
| L3   | a11y tree 语义匹配                                             | 中         | 10%      |
| L4   | 视觉/CV 定位                                                   | 高         | 5%       |

### v1 实现（L1 + L2）

```typescript
async function executeWithFallback(
  step: PathStep,
  pageManager: PageManager
): Promise<ExecuteResult> {
  const page = await pageManager.getCurrent();
  const selector = step.args.selector as string | undefined;

  // L1: 首选选择器
  if (selector) {
    try {
      const locator = page.locator(selector);
      await executeTool(step.tool, locator, step.args);
      return { status: "success" };
    } catch (e) {
      if (!isLocatorError(e)) throw e;
    }
  }

  // L1: 备用选择器
  for (const fallback of step.selectorFallbacks ?? []) {
    try {
      const locator = page.locator(fallback);
      await executeTool(step.tool, locator, step.args);
      return { status: "success", updatedSelector: fallback };
    } catch {}
  }

  // L2: Playwright 内置策略
  const hint = step.semanticHint;
  if (hint?.ariaLabel) {
    try {
      const locator = page.getByLabel(hint.ariaLabel);
      await executeTool(step.tool, locator, step.args);
      return {
        status: "success",
        updatedSelector: `getByLabel("${hint.ariaLabel}")`,
      };
    } catch {}
  }

  if (hint?.nearText) {
    try {
      const locator = page.getByText(hint.nearText);
      await executeTool(step.tool, locator, step.args);
      return { status: "success" };
    } catch {}
  }

  // 判断失效类型
  return classifyFailure(page, step);
}
```

---

## 8. 迁移路径

阶段划分：

1. **Phase 1：自建循环 + trace 兼容**
   - 替换 `generateText` 为 `AgentLoop`
   - 保持 `TraceRecorder` 工作（适配新的事件格式）
   - 验证功能等价性

2. **Phase 2：缓存层 + 路径提取**
   - 实现 `MemoryPathCache`
   - 实现 `PathExtractor`（保守策略）
   - `act()` 执行前查询缓存，命中则 replay

3. **Phase 3：弹性匹配 + 断点续传**
   - 实现 `PathReplayer` 的检查点机制
   - 实现 `executeWithFallback`
   - 实现 LLM 接管的消息构建

4. **Phase 4：自愈 + 持久化**
   - 缓存命中时更新选择器（自愈）
   - 缓存持久化到文件系统
