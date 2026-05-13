## 上下文

`core` 包目前有三个层级涉及浏览器动作：

1. **`interaction/`** — 最底层。DOM 原语如 `clickByBackendNodeId()`、`fillByBackendNodeId()`、`findBackendNodeIdBySelector()`。
2. **`tools/`** — 面向 LLM 的层。每个工具（click、fill、navigate、waitFor、tabs、snapshot、screenshot）用 Zod schema 和 `refMap` 解析包装 `interaction/`。`tools/click.ts` 和 `tools/fill.ts` 各自包含一个完全相同的 `resolveTarget()` 辅助函数。
3. **`memory/replayer.ts`** — 回放层。独立地将定位器/选择器解析为 `backendNodeId` 并分发相同的动作（navigate、click、fill、waitFor、tabs）。它完全不使用 `tools/`。

这意味着一个简单的"点击元素"会根据发起者是 LLM 还是 replayer 而流经两条完全不同的代码路径。任何 bug 修复或行为变更（例如在 navigate 后增加等待）必须在两个地方同时修改。

此外，`cdp/page.ts` 暴露了一些便捷方法（`navigate`、`screenshot`、`evaluate`、`getFrameTree`），它们只是对 `this.send()` 的薄包装。它们增加了 API 表面积却没有抽象价值，并且使 `CDPPageManager` 看起来像一个高级页面驱动器，而非纯 CDP 会话路由器。

## 目标 / 非目标

**目标：**

- 引入单一的 `actions/` 层，封装 Agent 可以执行的每个浏览器动作。
- 让 `tools/` 和 `memory/replayer.ts` 都消费 `actions/` —— 不再存在重复的执行逻辑。
- 从 `cdp/page.ts` 移除便捷方法；所有 CDP 调用方直接使用 `send()`。
- 保持外部 `BrowserAgent` API 不变。

**非目标：**

- 不修改快照序列化逻辑。
- 不修改定位器算法（语义、结构、回退）。
- 不修改 memory 存储格式（`MemorizedPath`、`PathStep`）。
- 不添加现有动作之外的新动作（click、fill、navigate、waitFor、tabs）。
- 不修改 LLM 提供方或 Agent 循环。

## 决策

### 决策：Actions 层位于 `tools/` 和 `interaction/` 之间

**理由：** `interaction/` 层级太低（仅 backendNodeId）。`tools/` 层级太高（Zod + 描述 + refMap）。我们需要一个中间层，接受丰富的参数（selector、locator、value、url）并编排底层原语。

**已考虑的替代方案：**

- 让 replayer 直接复用 `tools/` —— 拒绝，因为工具携带了 replayer 不需要的 LLM 特定元数据（描述、Zod schema）。
- 将所有内容移入 `interaction/` —— 拒绝，因为 `interaction/` 应保持纯 CDP DOM 操作。

### 决策：Actions 是普通异步函数，不是类

**理由：** Actions 是无状态的转换（args + pageManager → result）。类会增加样板代码却无收益。

**已考虑的替代方案：**

- 带 `execute()` 方法的 `Action` 类 —— 拒绝，对于无状态函数来说过于工程化。

### 决策：`cdp/page.ts` 的便捷方法直接移除，不废弃

**理由：** 这是内部包，`CDPPageManager` 没有外部消费者。废弃周期是不必要的开销。

**已考虑的替代方案：**

- 保留方法作为别名 —— 拒绝，因为保留了我们要消除的混乱。

### 决策：`refMap` 生命周期保留在 `tools/` 中，不移入 `actions/`

**理由：** `refMap` 是 LLM 工具相关的概念（将 `@ref` 字符串映射到定位器）。Replayer 和 actions 层不使用 ref。将它移入 `actions/` 会用 LLM 特定的状态污染共享层。

### 决策：`navigate` 动作返回实际 URL，但不清除 `refMap`

**理由：** 目前 `tools/navigate.ts` 在导航后清除 `context.refMap = undefined`。这是工具侧的关注点，因为 refMap 仅对 LLM 工具上下文有意义。动作原语应该只导航并返回 URL。工具和 replayer 随后可以决定如何处理副作用。

## 风险 / 权衡

| 风险                                                               | 缓解措施                                                                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 如果 actions 与当前 replayer 逻辑不同，replay 行为可能发生微妙变化 | 在切换调用方之前，将每个动作的实现与当前的 `tools/` 和 `memory/replayer.ts` 进行对比。为动作输出添加单元测试。              |
| 移除 `pageManager.navigate()` 等方法可能破坏重构时遗漏的调用点     | 移除后，在整个工作区运行 `tsc --noEmit` 以捕获任何剩余引用。                                                                |
| 如果过多职责堆积，`actions/` 可能成为"上帝模块"                    | 严格限制 actions 的职责范围：(1) 解析目标，(2) 执行 CDP 原语，(3) 返回结构化结果。不包含快照逻辑、memory 逻辑、LLM 格式化。 |

## 迁移计划

1. 创建 `actions/` 目录，从 `tools/click.ts`、`tools/fill.ts` 和 `memory/replayer.ts` 提取共享函数。
2. 更新 `tools/*` 以导入并调用 `actions/` 函数。
3. 更新 `memory/replayer.ts` 以导入并调用 `actions/` 函数。
4. 将所有 `pageManager.navigate()`、`screenshot()`、`evaluate()`、`getFrameTree()` 调用内联为 `pageManager.send()`。
5. 从 `cdp/page.ts` 删除便捷方法。
6. 删除空的 `context/` 目录。
7. 运行类型检查和现有测试。

## 待解决问题

- `waitFor` 动作应该同时支持 selector 等待和固定毫秒等待，还是 replayer 和工具应该调用不同的原语？
  _决议：统一的 `waitFor` 动作接受两种模式，与当前工具行为一致。_
- 标签页管理（list/switch/new）应该属于 `actions/` 还是保持临时实现？
  _决议：为保持一致性，纳入 `actions/`；它和其他浏览器动作一样。_
