## Context

当前 `packages/core/src/snapshot/serializer.ts` 存在一个剪枝 bug：当 `shouldInclude()` 对 `ignored` 结构包装节点返回 false 时，`serializeNode()` 返回 `null`，切断了该节点下方的整棵子树。一个包含 54 个 AX 节点的登录页会坍缩成只剩一个 `RootWebArea` 节点。

除了这个 bug，snapshot 输出是纯文本，没有任何元素引用。LLM 只能猜测 CSS selector 或使用脆弱的 `textContent.includes()` 文本匹配。这造成了一种割裂：已有的多策略 `ElementLocator` 框架（`locator/find.ts`、`memory/types.ts`、`memory/replayer.ts`）已经完整，但工具层完全不走这套框架，而是依赖 `document.querySelector` 和 `textContent.includes` — 既不精确也不健壮。

## Goals / Non-Goals

**Goals:**

- 修复 snapshot 剪枝 bug，使树正确保留子节点
- 为 snapshot 输出添加稳定的 ref ID（`@e1`、`@e2`...）
- 将现有的 locator 框架桥接到工具执行层
- 将 click/fill 从 JS 事件模拟升级到 CDP Input 域事件
- 从 click/fill 工具中移除脆弱的 `text` 参数
- 为 Tool 接口增加 `context` 参数，使 refMap 显式传递
- 修复 JS 表达式构建中的安全漏洞

**Non-Goals:**

- 重写 locator 框架（它已经能工作）
- 添加新的定位策略（如图像匹配、视觉 AI）
- 支持多 frame ref 解析（iframe ref 映射留给未来工作）
- 更换 LLM provider 或 agent 循环架构
- 添加超出 click/fill/snapshot 更新范围的新工具

## Decisions

### Decision: Tool 接口增加 `context` 参数，而非闭包工厂

**Rationale**: 我们考虑过两种方案。闭包工厂（`createClickTool(services)`）保持现有接口不变，但引入了不可见的引用、调试摩擦和测试 mock 膨胀。增加 `execute(args, context)` 使依赖在每个调用点都显式化，支持并发执行（每次调用获得自己的 context 快照），且使堆栈跟踪可读。迁移成本很低：约 8 个工具文件 + `loop.ts` 中的 1 行。

### Decision: 使用 CDP Input 事件替代 JS `el.click()` / `el.value`

**Rationale**: JS 事件（`element.click()`、`element.value = 'x'`）不会触发真实的浏览器输入管线。某些站点依赖 `mousedown`/`mouseup` 序列、命中测试或原生输入验证。CDP `Input.dispatchMouseEvent` 和 `Input.insertText` 经过浏览器的实际事件系统，与 Stagehand 和 Agent-Browser 的行为一致。

**Trade-off**: 需要 `DOM.resolveNode` → `objectId` → `DOM.scrollIntoViewIfNeeded` → `DOM.getBoxModel` 坐标解析。更多的 CDP 往返，但行为正确。

### Decision: ref 优先，selector 保留为 fallback，text 移除

**Rationale**: 一旦 snapshot 携带 ref，LLM 就有了精确的元素寻址能力。`text` 匹配（`textContent.includes`）一直是缺乏 ref 时的变通方案，且本质上存在歧义（部分匹配、隐藏文本、重复标签）。保留 `selector` 作为 fallback 保持了向后兼容性，并处理 LLM 已经知道精确 CSS selector 的场景。

**Breaking change**: `text` 参数从 click 和 fill 工具 schema 中移除。

### Decision: `refMap` 是 `Map<string, ElementLocator>`，通过 ToolContext 传递

**Rationale**: `getSnapshot` 生成 ref-to-locator 映射并通过 `ToolContext` 传递。每个工具执行接收到 snapshot 当时的 refMap。这避免了在 `pageManager` 上设置全局 mutable 状态，同时保持流程显式。

### Decision: 孤儿代码（`adapter.ts`、`domsnapshot.ts`）保持不动

**Rationale**: 两个文件都是死代码，但删除它们超出了本次变更的范围。它们将单独评估。

## Risks / Trade-offs

| Risk                                                                                      | Mitigation                                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Ref ID 是 session-local 的** — snapshot A 的 `@e1` 不会匹配 snapshot B（如果 DOM 变化） | 符合预期。Ref 用于 session 内精确引用。跨 session replay 使用提取到 memory 中的 `ElementLocator`，而非原始 ref ID。 |
| **CDP Input 事件对视口外元素可能失败**                                                    | 在 `getBoxModel` 之前调用 `DOM.scrollIntoViewIfNeeded`。如果滚动失败，错误作为工具失败传播给 LLM。                  |
| **Tool 接口变更是 breaking 的**                                                           | 所有 tool 的 execute 签名都变。缓解：约 8 个工具的机械性迁移；非交互式工具（navigate、screenshot 等）没有逻辑变更。 |
| **System prompt 需要更新**                                                                | LLM 必须被教导优先使用 `ref` 而非 `text`。如果 prompt 不更新，LLM 可能继续发出无效的 `text` 参数。                  |
| **`evaluate()` JS 注入漏洞**                                                              | 用 `JSON.stringify()` 替代所有进入 JS 表达式的用户提供的值的手动转义。                                              |
| **Memory extractor 需要支持 ref**                                                         | `extractLocator()` 目前解析 `selector`/`text`。必须扩展以从 trace context 解析 `ref` → `ElementLocator`。           |
