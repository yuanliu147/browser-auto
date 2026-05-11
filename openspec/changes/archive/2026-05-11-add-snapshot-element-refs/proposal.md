## Why

当前 snapshot 系统有两个根本问题：

1. **剪枝 bug**：`serializer.ts` 中 `shouldInclude()` 对 `ignored` 包装节点返回 false 后，`serializeNode()` 直接返回 null，切断了整棵子树。一个包含 54 个 AX 节点的登录页会坍缩成只有 1 个 `RootWebArea` 节点。

2. **没有元素引用**：snapshot 输出是纯文本，没有 ref/ID 系统。LLM 只能猜 CSS selector 或用 `textContent.includes()` 做文本匹配 — 这两者都很脆弱。与此同时，`locator/find.ts` + `memory/types.ts` + `memory/replayer.ts` 已经构成了完整的多策略定位框架，但工具层（`tools/click.ts`、`tools/fill.ts`）完全不走这套框架，而是直接用 `Runtime.evaluate` 拼 JS 表达式。

## What Changes

- **修复 snapshot 剪枝 bug**：`serializeSnapshot()` 对 `ignored` 节点做透明化处理，递归输出子节点而非直接丢弃
- **snapshot 输出增加 ref ID**：可交互元素分配递增 ref（`@e1`、`@e2`...），附带 `refMap` 映射每个 ref 到 `ElementLocator`
- **移除 click/fill 的 `text` 参数**：文本匹配过于脆弱，用 ref 和 selector 替代
- **click/fill 增加 `ref` 参数**：LLM 可直接引用 snapshot 中的元素
- **Tool 接口增加 `context` 参数**：`execute(args, context)` 接收 `pageManager` 和 `refMap`，消除全局 mutable 状态
- **click/fill 执行升级为 CDP Input 事件**：用 `DOM.resolveNode` → `DOM.scrollIntoViewIfNeeded` → `DOM.getBoxModel` → `Input.dispatchMouseEvent` / `Input.insertText` 替代 JS `el.click()` 和 `el.value = ''`
- **桥接工具层到 locator 框架**：click/fill 先通过 `locateElement()` 解析 ref，失败再降级到 selector
- **修复 handover snapshot 退化**：`runWithHandover` 用 `getSnapshot()` 替代 `document.body.innerText`
- **修复 JS 注入漏洞**：用 `JSON.stringify()` 替代字符串拼接转义
- **更新 system prompt**：指导 LLM 优先使用 ref

## Capabilities

### New Capabilities

- `cdp-element-interaction`: 通过 CDP Input domain 实现底层元素交互（鼠标和键盘事件分发），替代 JS 方式的 click/fill

### Modified Capabilities

- `snapshot-format`: snapshot 输出将包含元素 ref ID 并暴露 `refMap` 供工具消费。需求变更：输出格式、ref 分配规则、交互元素识别
- `semantic-element-locator`: locator 框架将被工具执行层消费，不再仅限于 memory replay 层。需求变更：locator 解析成为工具执行的一等路径
- `browser-agent`: Tool 接口变更（`execute` 签名）、system prompt 更新、handover 行为变更。需求变更：tool 参数 schema（增加 `ref`，移除 `text`）
- `operation-trace`: Trace recorder 需要捕获 refMap 状态以便 memory extraction 准确反解。需求变更：trace 数据模型扩展

## Impact

- `packages/core/src/snapshot/serializer.ts` — 剪枝修复 + ref 分配
- `packages/core/src/snapshot/adapter.ts` — **BREAKING** 孤儿代码，评估移除
- `packages/core/src/snapshot/domsnapshot.ts` — **BREAKING** 孤儿代码，评估移除
- `packages/core/src/tools/*.ts` — 所有工具更新接口
- `packages/core/src/loop/types.ts` — Tool 接口 breaking change
- `packages/core/src/loop/loop.ts` — execute 调用点更新
- `packages/core/src/cdp/page.ts` — 增加 refMap 字段
- `packages/core/src/agent.ts` — handover 修复
- `packages/core/src/prompts/system.ts` — prompt 更新
- `packages/core/src/memory/extractor.ts` — 支持 `ref` 参数提取
- 新增: `packages/core/src/interaction/` — CDP click/fill 实现
