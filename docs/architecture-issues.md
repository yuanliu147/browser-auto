# 架构问题清单

> 记录当前代码中的已知缺陷和改进方向，按层次分类。

---

## 数据层

### 1. snapshot 不处理 iframe

`Accessibility.getFullAXTree` 只返回当前 frame 的 accessibility tree。iframe 里的元素完全不可见，也无法交互。

相关代码：`packages/core/src/snapshot/axtree.ts`

### 2. locator 太弱，不保证唯一性

`buildLocator()` 只使用 `node.name` 生成定位信息，没有利用 `collectDOMInfo` 收集的 DOM 属性（aria-label、placeholder、tagName、formIndex 等）。

同名元素（如两个 "Submit" 按钮）时，`findByTextContent` 只返回第一个匹配，可能定位到错误元素。

相关代码：`packages/core/src/snapshot/serializer.ts:70-78`, `packages/core/src/locator/find.ts`

### 3. traces 里杂质多，没有提取干净的成功路径

Trace 是 LLM 原始调用的审计日志，包含 exploratory tools（getSnapshot、screenshot）、失败重试、ref 等。需要从中提取出"干净的成功路径"。

当前 `extractMinimalPath()` 做了这件事，但流程绕弯：trace 存 ref → extractor 查 refMap 转 locator → replay 用 locator。

相关代码：`packages/core/src/memory/extractor.ts`, `packages/core/src/logger/recorder.ts`

### 4. trace 类型不严格

`TraceStep.refMap` 和 `TraceRecorder.currentRefMap` 的类型是 `Record<string, unknown>` / `Map<string, unknown>`，丢失了 `ElementLocator` 的类型信息。

相关代码：`packages/core/src/logger/types.ts:26`, `packages/core/src/logger/recorder.ts:34`

---

## 定位层

### 5. JS evaluate → CSS selector 回查有漏洞

`findByLabelText` / `findByTextContent` 先执行 JS 返回 `{tagName, id, className}`，再用这些信息拼 CSS selector 回查 `backendNodeId`。

问题：

- 没有 `id` 且 `className` 不唯一时，`querySelector` 可能匹配到不同元素
- `className` 含多个 class 时只取第一个，更容易匹配错误

相关代码：`packages/core/src/locator/find.ts:47-133`

### 6. 不检查元素可见性/交互性

`isRefable()` 只检查 role 和 onclick handler，不检查：

- `display: none` / `visibility: hidden`
- 元素是否在视口内
- 是否被其他元素遮挡
- `disabled` 状态

LLM 可能拿到不可交互元素的 ref，click 时失败。

相关代码：`packages/core/src/snapshot/serializer.ts:64-68`

### 7. 没有 shadow DOM 支持

`collectDOMInfo()` 用了 `DOM.getFlattenedDocument({pierce: true})` 能穿透 shadow DOM 收集信息，但 `queryBackendNodeId()` 用的 `DOM.querySelector` 不能 pierce。

相关代码：`packages/core/src/locator/find.ts:218-242`, `packages/core/src/snapshot/axtree.ts:102`

---

## 执行层

### 8. 没有等待机制

`waitFor` 工具只是固定时间 sleep：

```typescript
const ms = args.ms as number | undefined;
if (ms) await new Promise((r) => setTimeout(r, ms));
```

缺失真正的条件等待：

- 点击后等待页面跳转/加载完成
- 等待元素出现/消失（类似 Playwright 的 `waitForSelector`）
- 等待 AJAX 请求完成

相关代码：`packages/core/src/tools/wait.ts`

### 9. 没有处理表单提交后的页面跳转

`navigate` 工具会清除 `refMap`，但 click 触发的表单提交、AJAX 导航没有检测和等待机制。

相关代码：`packages/core/src/tools/navigate.ts:12-22`

### 10. CDPPageManager 没有多 frame 支持

`CDPPageManager.send()` 总是发到 `currentTargetId`，不能切换 iframe 或处理多 tab。

相关代码：`packages/core/src/cdp/page.ts:81-87`

---

## 控制层

### 11. LLM 可能陷入循环，无干预机制

`AgentLoop` 的结束条件只有 `hasSubmitDone || toolCalls.length === 0`。如果 LLM 不断调用 `getSnapshot` 但不执行操作，会耗尽 `maxSteps`。

没有"连续多次 getSnapshot 无进展"或"参数格式错误多次"的检测和干预。

相关代码：`packages/core/src/loop/loop.ts:154-157`

### 12. handover 和正常路径分离，代码重复

`agent.ts` 里两条独立路径：

- `runLoop()` — 正常 AI 执行
- `runWithHandover()` — replay 失败后交接给 LLM

各自维护 recorder、messages、refMap 等状态，容易不一致。

相关代码：`packages/core/src/agent.ts:131-277`

### 13. 工具参数校验和业务逻辑混在一起

每个 tool 文件同时做三件事：定义 zod schema、定义工具描述、执行逻辑（含定位 + 操作）。

`tools/click.ts` 和 `tools/fill.ts` 里有几乎一样的 `resolveTarget()` 函数。

相关代码：`packages/core/src/tools/click.ts:40-61`, `packages/core/src/tools/fill.ts:41-62`

---

## 资源层

### 14. screenshot 产生大量文件，无配置控制

每次交互工具调用前后都拍 screenshot，长时间任务会产生大量图片，磁盘占用大。

相关代码：`packages/core/src/logger/recorder.ts:66-106`
