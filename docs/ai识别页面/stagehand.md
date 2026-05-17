# Stagehand V3 AI 识别页面设计分析

## 一、核心架构：Hybrid Snapshot（混合快照）

Stagehand V3 的页面认知层采用**混合 DOM + 无障碍树（Accessibility Tree）**的方案，核心入口在：

```
/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/capture.ts
```

**关键设计决策**：页面文本大纲的**结构完全来自 A11y 树**，DOM 树只作为辅助数据源提供 XPath、tagName、scrollable 等映射信息。所有 Handler（act/observe/extract）均使用 `combinedTree`（A11y 树的文本化表示）作为给 LLM 的输入。

---

## 二、Snapshot 五层捕获流程

| 步骤      | 函数                      | 位置                                                                                            | 说明                                                             |
| --------- | ------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1（可选） | `tryScopedSnapshot`       | `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/capture.ts:119` | 若传入 `focusSelector`，只捕获该子树，失败则回退全量捕获         |
| 2         | `buildSessionIndexes`     | `capture.ts:241`                                                                                | 为每个唯一 CDP session 调用 `DOM.getDocument`，构建共享 DOM 索引 |
| 3         | `collectPerFrameMaps`     | `capture.ts:268`                                                                                | 每 frame 收集 DOM maps + 获取 AX tree outline                    |
| 4         | `computeFramePrefixes`    | `capture.ts:348`                                                                                | 计算跨 iframe 的绝对 XPath 前缀                                  |
| 5         | `mergeFramesIntoSnapshot` | `capture.ts:417`                                                                                | 合并所有 frame 结果，生成 `combinedTree` + `combinedXpathMap`    |

---

## 三、DOM 树的实际作用（辅助层）

DOM 树在 snapshot 中**只产出三项映射**，其结构层级不用于构建文本大纲：

```typescript
// /Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/domTree.ts

// 1. backendNodeId → XPath
tagNameMap:  { "0-45": "button" }
xpathMap:    { "0-45": "/html/body/div[2]/button" }
scrollableMap:{ "0-45": true }
```

### 3.1 DOM 遍历实现

- **`getDomTreeWithFallback`**：`/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/domTree.ts:138`
  - 调用 CDP `DOM.getDocument`，处理深层 DOM 的 CBOR 栈溢出（`CBOR: stack limit exceeded`）
  - 自适应深度重试：从 `-1`（完整）指数级降低到 `1`

- **`hydrateDomTree`**：`domTree.ts:57`
  - 对 `DOM.getDocument` 返回的截断树用 `DOM.describeNode` 补充缺失分支
  - 同样使用自适应深度重试策略

- **`buildSessionDomIndex`**：`domTree.ts:257`
  - 构建 session 级索引：`absByBe`（绝对 XPath）、`tagByBe`、`scrollByBe`、`docRootOf`、`contentDocRootByIframe`
  - 同一 session 的多个 iframe 共享此索引

### 3.2 Shadow DOM 穿透

- `pierceShadow: true`（默认）时，`DOM.getDocument` 和 `DOM.describeNode` 均传递 `pierce: true`
- Shadow root 在 XPath 中表示为 `//` hop：`joinXPath(base, "//")`

---

## 四、A11y 树的结构主导作用

### 4.1 获取与格式化链路

```
Accessibility.getFullAXTree
    ↓
a11yForFrame()              // /Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/a11yTree.ts:18
    ↓
decorateRoles()             // a11yTree.ts:102 — 用 DOM tagName/scrollable 增强 role
    ↓
buildHierarchicalTree()     // a11yTree.ts:153 — 用 parentId/childIds 构建层次树
    ↓
pruneStructuralSafe()       // 剪枝 generic/none/inlinetextbox 节点
    ↓
formatTreeLine()            // /Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/treeFormatUtils.ts:8
    ↓
combinedTree（纯文本）
```

### 4.2 decorateRoles：DOM 与 A11y 的缝合点

```typescript
// a11yTree.ts:109-150
if ((domIsScrollable || isHtmlElement) && tag !== "#document") {
  role = tagLabel ? `scrollable, ${tagLabel}` : `scrollable, ${role}`;
}
// File inputs 修正：Chrome AX tree 给的是 "button"，覆盖为 "input, file"
if (tag === "input, file") {
  role = tag;
}
```

### 4.3 剪枝策略

- **结构性节点剪枝**：`isStructural(role)` 匹配 `generic`/`none`/`inlinetextbox`，无意义时移除
- **StaticText 去重**：若子节点的 `StaticText` 拼接等于父节点 `name`，则移除冗余子节点
- **单孩子提升**：结构性节点只有一个孩子时，用孩子替换自己

### 4.4 输出格式

```
[0-2] heading: Welcome
  [0-5] link: About Us
[0-8] button, scrollable: Submit Form
  [0-12] text: Click here
```

编码 ID 格式：`frameOrdinal-backendNodeId`，如 `0-45`。

---

## 五、两树关联机制：backendNodeId 桥梁

| 数据源                      | 字段名                       | 作用                           |
| --------------------------- | ---------------------------- | ------------------------------ |
| DOM.getDocument             | `node.backendNodeId`         | DOM 遍历生成 `xpathMap[encId]` |
| Accessibility.getFullAXTree | `axNode.backendDOMNodeId`    | 与上同值，用于查找对应 XPath   |
| 统一编码                    | `opts.encode(be)` → `"0-45"` | 跨 frame 唯一标识              |

**关联流程**：

1. DOM 遍历：为每个 `backendNodeId` 计算 XPath → `xpathMap["0-45"] = "/html/body/..."`
2. A11y 遍历：`node.backendDOMNodeId === 45` → `encodedId = "0-45"`
3. 格式化：`[0-45] button: Submit`
4. LLM 返回 `"0-45"` → 查 `combinedXpathMap["0-45"]` → 执行动作

---

## 六、跨 iframe / Shadow DOM 处理

### 6.1 Frame 拓扑管理

- **`buildFrameContext`**：`capture.ts:98` — 构建 `parentByFrame` Map，记录 iframe 父子关系
- **`computeFramePrefixes`**：`capture.ts:348` — 计算每个子 frame 的绝对 XPath 前缀（父 iframe 元素的 XPath）
- **`mergeFramesIntoSnapshot`**：`capture.ts:417` — 将子 frame 的 outline 注入到父 iframe 节点下方

### 6.2 Scoped Snapshot（焦点定位）

```typescript
// capture.ts:119 — tryScopedSnapshot
// 支持两种 selector 跨 iframe：
//   - XPath: /html/body/iframe/html/body/div[1]
//   - CSS:   div.container >> iframe >> button.submit
```

- **`resolveFocusFrameAndTail`**：`/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/focusSelectors.ts:62`
  - 解析跨 frame XPath，逐段定位 iframe，返回目标 frameId + 尾段 XPath
- **`resolveCssFocusFrameAndTail`**：`focusSelectors.ts:139`
  - 用 `>>` 分隔 CSS selector，逐段 hop iframe

### 6.3 Deep Locator

- **`deepLocatorThroughIframes`**：`/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/deepLocator.ts:52`
- **`resolveLocatorTarget`**：`deepLocator.ts:65`
  - 统一解析 `>>` hop 表示法、跨 iframe XPath、普通单 frame selector

---

## 七、坐标解析（Hybrid Mode / CUA 使用）

### 7.1 坐标到 XPath 的反向解析

```typescript
// /Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/coordinateResolver.ts
resolveXpathForLocation(page, x, y);
```

- 调用 CDP `DOM.getNodeForLocation(x, y)` 获取坐标下的 `backendNodeId`
- 逐层穿透 iframe：若命中的是 iframe 元素，则计算其 bounding rect，将坐标转换到子 frame 继续查询
- 通过 `buildAbsoluteXPathFromChain` 构建跨 frame 绝对 XPath

### 7.2 元素中心点计算

```typescript
// /Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/locator.ts:246
centroid(): Promise<{ x: number; y: number }>
```

- `DOM.scrollIntoViewIfNeeded` + `DOM.getBoxModel` 获取元素几何信息
- 计算 content box 的中心点坐标

### 7.3 高亮元素

```typescript
// locator.ts:272
highlight(options?: { durationMs?, borderColor?, contentColor? })
```

- 使用 CDP `Overlay.highlightNode` 绘制半透明遮罩
- 优先使用 `backendNodeId` 而非 `objectId` 以保持稳定性
- 定时刷新抵抗页面重绘导致的遮罩消失

---

## 八、Agent 模式下的页面识别差异

### 8.1 DOM Agent（默认 / Hybrid 模式）

```
/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/handlers/v3AgentHandler.ts
```

- 使用 `createAgentTools` 构建工具集（包含 `act`、`extract`、`observe`）
- 底层仍调用 `captureHybridSnapshot` 获取文本树
- Hybrid 模式额外支持坐标点击（`click(x, y)`）、拖拽（`dragAndDrop`）

### 8.2 CUA Agent（Computer Use Agent）

```
/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/handlers/v3CuaAgentHandler.ts
```

- **不使用文本树，改用截图**：`setScreenshotProvider` 返回 base64 PNG
- 支持 OpenAI / Google / Anthropic 的 CUA 模型
- 通过视觉模型直接识别页面元素并返回坐标操作
- 仍使用 `computeActiveElementXpath` 获取焦点元素（辅助功能）

---

## 九、Cache 机制

### 9.1 Act Cache

```
/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/cache/ActCache.ts
```

- Cache Key：`SHA256(instruction + url + variableKeys)`
- 缓存内容：动作序列（selector、method、arguments）
- 重放时先 `waitForCachedSelector` 等待元素出现，再执行动作
- Self-heal 后若 selector 变化，自动更新缓存

### 9.2 Agent Cache

```
/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/cache/AgentCache.ts
```

- 缓存 Agent 执行上下文（页面状态、已完成步骤）
- 支持中断后恢复（`replayAgentCacheEntry`）

---

## 十、Self-heal（自愈）机制

```
/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/handlers/actHandler.ts:333
```

当 `performUnderstudyMethod` 抛出异常（元素未找到、不可点击等）：

1. 若 `selfHeal: true`，重新调用 `captureHybridSnapshot` 获取最新页面状态
2. 用原始 instruction 重新调用 `actInference`
3. 若 LLM 返回新的 selector，用新 selector 重试动作
4. 若仍失败，返回错误并记录调试信息

**Two-step 模式**（`actInferenceResponse.twoStep === true`）：

- 第一步执行动作后，比较前后 snapshot 差异（`diffCombinedTrees`）
- 将差异树 + 第一步结果传给 LLM，请求第二步动作
- 适用于需要多步交互的场景（如先打开下拉再选择）

---

## 十一、DOM Scripts 注入体系

### 11.1 构建系统

```
/Users/admin/WorkSpace/stagehand/packages/core/scripts/build-dom-scripts.ts
```

用 esbuild 将 TypeScript 源码编译为：

- **IIFE string**：直接注入页面（如 `piercer.entry.ts`）
- **Bootstrap module**：挂载到 `globalThis` 的工厂函数
- **Sources only**：提取函数源码字符串，通过 `Runtime.callFunctionOn` 调用

### 11.2 A11y Scripts

```
/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/dom/a11yScripts/index.ts
```

生成文件：`a11yScripts.generated.ts`

| 函数                       | 用途                              |
| -------------------------- | --------------------------------- |
| `getScrollOffsets`         | 获取窗口滚动偏移                  |
| `getBoundingRectLite`      | 轻量 boundingClientRect           |
| `resolveDeepActiveElement` | 穿透 shadow DOM 获取真正焦点元素  |
| `nodeToAbsoluteXPath`      | 从 DOM 节点向上遍历构建绝对 XPath |
| `documentHasFocusStrict`   | 严格检测 document 是否有焦点      |

### 11.3 Locator Scripts

```
/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/dom/locatorScripts/
├── xpathResolver.ts      # XPath 解析（snapshotItem）
├── selectors.ts          # CSS selector 解析
├── counts.ts             # 元素计数
└── waitForSelector.ts    # 等待元素出现
```

### 11.4 Screenshot Scripts

```
/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/dom/screenshotScripts/
└── resolveMaskRect.ts    # 截图遮罩区域解析
```

---

## 十二、Public API：Page.snapshot()

```typescript
// /Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/page.ts:1896
async snapshot(options?: PageSnapshotOptions): Promise<SnapshotResult> {
  const { combinedTree, combinedXpathMap, combinedUrlMap } =
    await captureHybridSnapshot(this, { pierceShadow: true, includeIframes });
  return { formattedTree: combinedTree, xpathMap: combinedXpathMap, urlMap: combinedUrlMap };
}
```

用户可直接调用 `page.snapshot()` 获取当前页面的 hybrid snapshot。

---

## 十三、Error Handling 设计

### 13.1 特定错误类型

```
/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/types/public/sdkErrors.ts
```

| 错误类                     | 触发场景                                                      |
| -------------------------- | ------------------------------------------------------------- |
| `StagehandSnapshotError`   | `captureHybridSnapshot` 失败                                  |
| `StagehandDomProcessError` | `DOM.getDocument` / `DOM.describeNode` 失败（含 CBOR 栈溢出） |
| `StagehandIframeError`     | 跨 iframe selector 解析失败                                   |
| `ActTimeoutError`          | Act 执行超时                                                  |
| `ObserveTimeoutError`      | Observe 执行超时                                              |

### 13.2 CBOR 栈溢出自适应处理

```typescript
// domTree.ts:16
function isCborStackError(message: string): boolean {
  return message.includes("CBOR: stack limit exceeded");
}

// 深度重试序列：[-1, 256, 128, 64, 32, 16, 8, 4, 2, 1]
const DOM_DEPTH_ATTEMPTS = [-1, 256, 128, 64, 32, 16, 8, 4, 2, 1];
```

---

## 十四、URL 提取与回填

### 14.1 从 A11y 树提取 URL

```typescript
// a11yTree.ts:224
function extractUrlFromAXNode(
  ax: Protocol.Accessibility.AXNode
): string | undefined {
  const urlProp = (ax.properties ?? []).find((p) => p.name === "url");
  return urlProp?.value?.value;
}
```

### 14.2 URL 字段转换

```typescript
// extractHandler.ts:46
function transformUrlStringsToNumericIds(schema);
```

- `extract` 时自动检测 schema 中的 `z.string().url()` 字段
- 临时替换为 `z.number()`，让 LLM 返回编码 ID 而非完整 URL（节省 token）
- 提取完成后通过 `combinedUrlMap` 将 ID 回填为真实 URL

---

## 十五、关键文件索引

### Snapshot 核心

| 文件                                                                                                   | 说明                                        |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/capture.ts`            | 主入口 `captureHybridSnapshot`              |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/a11yTree.ts`           | A11y 树获取、角色增强、层次构建、剪枝       |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/domTree.ts`            | DOM 树获取、索引构建、XPath 计算、CBOR 容错 |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/treeFormatUtils.ts`    | 文本格式化、子树注入、差异比较              |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/xpathUtils.ts`         | XPath 前缀拼接、规范化、分段构建            |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/focusSelectors.ts`     | 跨 iframe XPath/CSS selector 解析           |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/activeElement.ts`      | 焦点元素 XPath 计算（穿透 shadow DOM）      |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/coordinateResolver.ts` | 坐标 → XPath 反向解析                       |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/understudy/a11y/snapshot/index.ts`              | 模块导出                                    |

### Handler 层

| 文件                                                                                  | 说明                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------- |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/handlers/actHandler.ts`        | Act 执行、Self-heal、Two-step               |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/handlers/observeHandler.ts`    | 可交互元素发现（默认 instruction 引导 LLM） |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/handlers/extractHandler.ts`    | 结构化数据提取、URL 转换回填                |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/handlers/v3AgentHandler.ts`    | DOM/Hybrid Agent（文本树 + tools）          |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/handlers/v3CuaAgentHandler.ts` | CUA Agent（截图驱动）                       |

### Prompt / Inference

| 文件                                                              | 说明                            |
| ----------------------------------------------------------------- | ------------------------------- |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/prompt.ts`    | System/User prompt 构建         |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/inference.ts` | LLM 调用、schema 约束、响应解析 |

### DOM 脚本

| 文件                                                                             | 说明                                    |
| -------------------------------------------------------------------------------- | --------------------------------------- |
| `/Users/admin/WorkSpace/stagehand/packages/core/scripts/build-dom-scripts.ts`    | DOM 脚本编译构建                        |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/dom/a11yScripts/index.ts` | A11y 辅助函数（XPath 构建、焦点检测等） |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/dom/locatorScripts/`      | 定位器运行时脚本                        |

### Cache

| 文件                                                                        | 说明                 |
| --------------------------------------------------------------------------- | -------------------- |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/cache/ActCache.ts`   | Act 动作缓存与重放   |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/cache/AgentCache.ts` | Agent 执行上下文缓存 |

### 类型定义

| 文件                                                                              | 说明                             |
| --------------------------------------------------------------------------------- | -------------------------------- |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/types/private/snapshot.ts` | Snapshot 全部类型定义            |
| `/Users/admin/WorkSpace/stagehand/packages/core/lib/v3/types/private/handlers.ts` | `SupportedUnderstudyAction` 枚举 |

---

## 十六、未注意到的设计细节总结

以下是在讨论过程中容易遗漏但实际上重要的设计：

1. **V3 没有 V1/V2 的残留 Snapshot 实现**：V3 的 snapshot 是全新设计，旧版 `lib/` 下只有 `prompt.ts` 和 `inference.ts` 被复用，snapshot 逻辑完全在 `lib/v3/understudy/a11y/snapshot/` 中。

2. **DOM Scripts 的构建时编译**：所有注入浏览器的脚本都是通过 `build-dom-scripts.ts` 在**构建时**用 esbuild 编译为字符串/IIFE，而非运行时拼接字符串。这保证了类型安全和代码复用。

3. **CUA Agent 与 DOM Agent 的识别方式完全不同**：CUA 基于截图（视觉模型），DOM Agent 基于文本树（LLM 推理），两者在 `agent()` 的 `mode` 参数中区分。Hybrid 模式本质上是 DOM Agent 的增强版，增加了坐标工具。

4. **URL 字段的 token 优化**：Extract 时自动将 `z.string().url()` 替换为 `z.number()`，让 LLM 返回短编码 ID（如 `45`），提取后再通过 `combinedUrlMap` 回填真实 URL，节省大量 token。

5. **Self-heal 的缓存联动**：Self-heal 成功后会自动更新 ActCache 中的 selector，下次重放时直接使用 healed selector。

6. **`page.snapshot()` 是 Public API**：除了内部 Handler 使用，用户也可以直接调用 `page.snapshot()` 获取当前页面的完整 hybrid snapshot 用于调试。

7. **A11y 树的 `scopeApplied` 标志**：当 `focusSelector` 成功命中时，`a11yForFrame` 返回 `scopeApplied: true`，否则触发 fallback 到全量捕获。

8. **iframe 的坐标转换**：`coordinateResolver.ts` 不仅解析坐标到节点，还递归穿透 iframe，每进入一层就减去父 iframe 的 `boundingClientRect` 偏移。
