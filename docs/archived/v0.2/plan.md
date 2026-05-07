# browser-auto v0.2 健壮性实施计划

## Context

v0.1 已完成核心执行路径（act/extract/observe）+ L3/L2 分层记忆 + 7 个扩展钩子接口。v0.2 的目标是在不增加新能力的前提下，让现有能力在生产环境中可靠运行。当前代码存在以下脆弱点：

- 所有错误都是原生 `Error`，调用方无法做程序化的恢复决策
- 没有重试机制，网络抖动或 DOM 短暂不稳定即失败
- 同 page 的并发调用会交错执行，产生竞态条件
- `memory.json` 无上限增长，长期运行会膨胀
- 测试覆盖率仅 80%，无 fuzzing 测试验证 fingerprint 稳定性

## 方案概要

分 4 个阶段串行实现，每阶段可独立验证：

1. **错误分类层** — 新建 `src/errors.ts`，替换所有裸 `throw new Error`
2. **重试 + 并发锁** — 在 `executor/index.ts` 内嵌 retry loop，`page.ts` 加 per-page 锁
3. **记忆回收** — `file-memory.ts` 在 write 时执行 LRU + TTL 清理
4. **覆盖率提升** — 补测试 + fuzzing，vitest threshold 调至 90%

---

## 阶段 1：错误分类层

### 新建 `src/errors.ts`

```typescript
export class BrowserAutoError extends Error {
  constructor(
    message: string,
    public readonly recoverable: boolean,
    public readonly code: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class SelectorNotFoundError extends BrowserAutoError {
  constructor(message: string) {
    super(message, true, "SELECTOR_NOT_FOUND");
  }
}

export class LLMError extends BrowserAutoError {
  constructor(message: string) {
    super(message, true, "LLM_ERROR");
  }
}

export class MemoryCorruptError extends BrowserAutoError {
  constructor(message: string) {
    super(message, true, "MEMORY_CORRUPT");
  }
}

export class PolicyAbortError extends BrowserAutoError {
  constructor(reason: string) {
    super(`Policy aborted: ${reason}`, false, "POLICY_ABORT");
  }
}

export class NetworkTimeoutError extends BrowserAutoError {
  constructor(message: string) {
    super(message, true, "NETWORK_TIMEOUT");
  }
}
```

### 修改 `src/types.ts`

- `ActionResult.error?: Error` 保持类型为 `Error`，但运行时实际值均为 `BrowserAutoError` 子类
- `CreateSessionOptions` 增加 `afterPolicies?: AfterActionInterceptor[]`（当前仅暴露了 `policies` 作为 before）

### 修改 `src/executor/index.ts`

- `Empty selectors` → `throw new SelectorNotFoundError(...)`
- `No selector matched` → `throw new SelectorNotFoundError(...)`
- catch 块保留原始 error 类型（`error: err as Error` 即可，因为子类 instance 不变）

### 修改 `src/memory/file-memory.ts`

- `readMemoryFile()` 中 Zod parse 失败时 `throw new MemoryCorruptError(...)` 而非静默返回空
- `NotImplementedError` 保留，但改为 extend `BrowserAutoError(recoverable: false, 'NOT_IMPLEMENTED')`

### 修改 `src/llm/provider.ts`

- `generateObject` 外层包 try/catch
- 网络类错误（timeout / ECONNRESET / ETIMEDOUT）→ `NetworkTimeoutError`
- 其他 → `LLMError`

### 修改 `src/llm/mock-llm.ts`

- `throw new LLMError(...)` 替代裸 Error

### 修改 `src/session.ts`

- `Unknown browser mode` / `Session is closed` → `BrowserAutoError(recoverable: false, 'INVALID_CONFIG' / 'SESSION_CLOSED')`

### 修改 `src/index.ts`

- re-export 所有 error class

### 验证

- 新建 `tests/errors.test.ts`：检查每个子类的 `recoverable` / `code` / `instanceof BrowserAutoError`
- 验证 executor 在空 selector 和无匹配时抛出正确错误类型
- 验证 corrupt memory.json 触发 `MemoryCorruptError`

---

## 阶段 2：重试 + 并发锁

### Retry 设计

- retry 发生在 `executeSteps` 内部，对单 step 生效
- 默认最大 3 次，指数退避：`delay = 500ms * 2^(attempt-1)`
- 只有 `recoverable === true` 的错误才触发重试
- `idempotent: false` 时不重试（默认 `true`，置于 `NodeRef` 上）
- trace event 的 `attempt` 字段改为真实 attempt 编号

### 修改 `src/types.ts`

```typescript
export type NodeRef = {
  role: string;
  name: string;
  selectors: string[];
  idempotent?: boolean; // default true
};
```

### 修改 `src/executor/index.ts`

核心改动：将单 step 的执行抽为 `executeSingleStepWithRetry`，内含 retry loop。

```typescript
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function isRecoverable(err: unknown): boolean {
  return err instanceof BrowserAutoError && err.recoverable;
}

// 在 executeSteps 的 for...of 循环中：
for (const step of steps) {
  const result = await executeSingleStepWithRetry(page, step, opts);
  results.push(result);
}
```

`executeSingleStepWithRetry` 逻辑：

1. 读取 `getTarget(step)?.idempotent !== false` 得到 `isIdempotent`
2. `maxAttempts = isIdempotent ? MAX_RETRIES : 1`
3. for attempt = 1..maxAttempts:
   - 执行 interceptor before
   - try { 原有执行逻辑 } catch (err) {
     - if attempt === maxAttempts 或 !isRecoverable(err): return fail result
     - else: delay 后 continue
       }
   - 成功则 return success result，执行 interceptor after

### 并发锁设计

新建 `src/concurrency.ts`：

```typescript
export class AsyncLock {
  private queue: Promise<void> = Promise.resolve();

  acquire<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => fn());
    this.queue = result.catch(() => {});
    return result;
  }
}
```

### 修改 `src/page.ts`

- `enhancePage` 中创建 `const lock = new AsyncLock()`
- `createActFn` 返回的函数体：`return lock.acquire(async () => { ... })`
- `createExtractFn` 返回的函数体：`return lock.acquire(async () => { ... })`
- `createObserveFn` 返回的函数体：`return lock.acquire(async () => { ... })`

**理由**：把整个函数体锁起来。LLM 调用本身耗时较长，如果在锁外并行，两个调用可能拿到同一 fingerprint 然后都进入 L0，既浪费 token 又可能导致 DOM 状态不一致。v0.2 追求"稳"，串行化是最安全的选择。

### 修改 `src/session.ts` 和 `src/quick.ts`

- `CreateSessionOptions.afterPolicies` 透传至 `enhancePage` 的 `afters` 参数
- `WrapOptions` 同步增加 `afterPolicies`

### 验证

- 新建 `tests/retry.test.ts`：mock page.locator 前两次失败第三次成功；mock 永久失败验证 3 次后抛错；验证 `idempotent: false` 只试 1 次；验证 `PolicyAbortError` 不重试
- 新建 `tests/concurrency.test.ts`：并发调用 act + extract，验证执行顺序串行（通过 trace event 时间戳或 mock 副作用顺序）
- 扩展 `tests/interceptor.test.ts`：afterPolicies 被正确调用

---

## 阶段 3：记忆回收（LRU + TTL）

### 设计

- 清理在 `rememberPlan` / `rememberLocator` 时触发（write 时摊销）
- TTL：默认 30 天，按 `lastUsedAt`（action）或 `lastUsedAt`（locator，需新增字段）判断
- LRU：超过 max 数量时，按 `lastUsedAt` 从新到旧截断
- 默认限制：actions 1000，locators 2000，regions 500

### 修改 `src/types.ts`

```typescript
export type MemoryLimits = {
  maxActions?: number;
  maxLocators?: number;
  maxRegions?: number;
  ttlDays?: number;
};

export type MemoryConfig = {
  enabled: boolean;
  path: string;
  limits?: MemoryLimits;
};
```

### 修改 `src/memory/schema.ts`

- locator record schema 增加 `lastUsedAt: z.string().optional()`
- region record schema 增加 `lastUsedAt: z.string().optional()`（为 v0.3 预留）

### 修改 `src/memory/locator-memory.ts`

- `createLocatorRecord` 写入 `lastUsedAt: now`
- `matchLocator` 命中时更新 `lastUsedAt`

### 修改 `src/memory/file-memory.ts`

- 构造函数增加 `limits: MemoryLimits = {}` 参数
- 新增 `private cleanup(data: MemoryFile): void`：
  1. 计算 cutoff = Date.now() - ttlDays \* 24h
  2. actions：filter `stats.lastUsedAt >= cutoff` → sort 降序 → slice maxActions
  3. locators：filter `lastUsedAt >= cutoff` → sort 降序 → slice maxLocators
  4. regions：同逻辑 slice maxRegions
- `rememberPlan` / `rememberLocator` 写文件前调用 `cleanup(data)`

### 修改 `src/memory/index.ts`

- `createMemory(config)` 将 `config.limits` 传给 `FileMemory`

### 验证

- 扩展 `tests/memory.action.test.ts`：`maxActions: 3` 时只保留最近 3 条
- 扩展 `tests/memory.locator.test.ts`：`recallLocator` 更新 `lastUsedAt`
- 新建 `tests/memory.cleanup.test.ts`：TTL 淘汰、LRU 截断、混合行为

---

## 阶段 4：测试覆盖率提升

### 修改 `vitest.config.ts`

- `include` 扩展至 `src/**/*.ts`（排除 `src/llm/prompts/**`、`src/debug.ts`）
- threshold 提升到 90% 的模块：
  - `src/memory/**`
  - `src/executor/**`（新增覆盖 executor/index.ts）
  - `src/errors.ts`
  - `src/concurrency.ts`
- 新增 threshold：`src/errors.ts` 和 `src/concurrency.ts`

### 新建 `tests/fuzz-fingerprint.test.ts`

使用 `login.html` / `product-list.html` fixture：

1. 加载页面，计算 fingerprint → reload 10 次，每次 fingerprint 相同
2. 添加 invisible DOM 节点 → fingerprint 不变
3. 修改非交互元素文本 → fingerprint 不变
4. 添加新交互元素 → fingerprint 变

### 扩展现有测试

- `tests/interceptor.test.ts`：after interceptor 接收 error result；before + after 混合顺序
- `tests/planner.test.ts`：空 nodes / 空 fields 的边界行为
- `tests/trace.test.ts`：单个 sink 抛错不中断其他 sink；FileTraceSink 写错误处理

---

## 文件变更清单

| 文件                                | 操作   | 说明                                                                 |
| ----------------------------------- | ------ | -------------------------------------------------------------------- |
| `src/errors.ts`                     | 新建   | 错误基类 + 5 个子类                                                  |
| `src/concurrency.ts`                | 新建   | AsyncLock                                                            |
| `src/types.ts`                      | 修改   | NodeRef.idempotent、MemoryLimits、MemoryConfig.limits、afterPolicies |
| `src/index.ts`                      | 修改   | re-export errors                                                     |
| `src/page.ts`                       | 修改   | lock.acquire 包裹 act/extract/observe                                |
| `src/executor/index.ts`             | 修改   | retry loop、结构化错误                                               |
| `src/executor/selector-resolver.ts` | 不修改 | 无变更（返回 null 的语义不变）                                       |
| `src/session.ts`                    | 修改   | afterPolicies 透传、结构化错误                                       |
| `src/quick.ts`                      | 修改   | afterPolicies 透传                                                   |
| `src/llm/provider.ts`               | 修改   | LLMError / NetworkTimeoutError 包装                                  |
| `src/llm/mock-llm.ts`               | 修改   | LLMError                                                             |
| `src/memory/file-memory.ts`         | 修改   | cleanup()、MemoryCorruptError、limits                                |
| `src/memory/schema.ts`              | 修改   | locator.lastUsedAt、region.lastUsedAt                                |
| `src/memory/locator-memory.ts`      | 修改   | 写入/更新 lastUsedAt                                                 |
| `src/memory/index.ts`               | 修改   | limits 透传                                                          |
| `src/memory/region-memory.ts`       | 修改   | NotImplementedError extend BrowserAutoError                          |
| `vitest.config.ts`                  | 修改   | 90% threshold、扩大 include                                          |
| `tests/errors.test.ts`              | 新建   | 错误类属性验证                                                       |
| `tests/retry.test.ts`               | 新建   | retry 场景                                                           |
| `tests/concurrency.test.ts`         | 新建   | 并发串行验证                                                         |
| `tests/memory.cleanup.test.ts`      | 新建   | LRU + TTL                                                            |
| `tests/fuzz-fingerprint.test.ts`    | 新建   | fingerprint 稳定性 fuzzing                                           |
| `tests/memory.action.test.ts`       | 扩展   | maxActions 截断                                                      |
| `tests/memory.locator.test.ts`      | 扩展   | lastUsedAt 更新                                                      |
| `tests/interceptor.test.ts`         | 扩展   | afterPolicies、error result                                          |
| `tests/planner.test.ts`             | 扩展   | 空输入边界                                                           |
| `tests/trace.test.ts`               | 扩展   | sink 错误隔离                                                        |

---

## 退出标准（验证方式）

1. **错误分类验证**：`npm test` 全过，新增 `tests/errors.test.ts` 验证每个子类的 `code` 和 `recoverable`
2. **重试验证**：`tests/retry.test.ts` 验证指数退避、max 3 次、非 idempotent 不重试
3. **并发验证**：`tests/concurrency.test.ts` 验证 `Promise.all([act, extract])` 的 trace 时间戳无重叠
4. **记忆回收验证**：`tests/memory.cleanup.test.ts` 验证 TTL 淘汰 + LRU 截断；跑 1000 次 rememberPlan 后 memory.json < 5MB
5. **覆盖率验证**：`npm run test:coverage` 全模块 ≥ 90%，新增模块 100%
6. **端到端**：运行现有 5 个 example，行为与 v0.1 一致（不破坏已有功能）
