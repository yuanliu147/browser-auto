# Playwright vs 原生 CDP：深度对比与实践指南

> 本文从 Stagehand 等 AI 浏览器自动化框架的实践经验出发，深入对比 Playwright 与原生 Chrome DevTools Protocol (CDP) 在 iframe 处理、性能、控制能力等维度的差异，并附可复现的性能测试数据。

---

## 一、设计哲学的根本差异

| 维度         | Playwright                                                      | 原生 CDP                         |
| ------------ | --------------------------------------------------------------- | -------------------------------- |
| **设计目标** | 端到端测试框架                                                  | 浏览器调试与诊断协议             |
| **抽象层级** | 高：隐藏浏览器内部细节                                          | 低：直接操作浏览器内部           |
| **API 风格** | 面向开发者友好，自动等待、重试                                  | 面向协议精确，需手动管理状态     |
| **典型用户** | QA 工程师、测试开发者                                           | 浏览器工具、DevTools、自动化框架 |
| **通信路径** | 代码 → Playwright Client → Playwright Server (Node.js) → Chrome | 代码 → Chrome CDP WebSocket      |

Playwright 的"测试优先"设计意味着它内置了大量可靠性机制（自动等待元素可见/稳定、actionability 检查、智能重试），这些在测试场景是优势，但在需要**高频、低延迟、细粒度控制**的 AI Agent 自动化场景反而成为负担。

---

## 二、iframe 处理：Playwright 的六大致命限制

### 限制 1：CDP Session 是 Page 级别，而非 Frame 级别

**CDP 原生能力：**
CDP 本身支持**按帧路由命令**。通过为每个 frame 创建独立的 `Runtime.ExecutionContext`，可以用 `contextId` 参数精确指定在哪个 frame 中执行 JavaScript 或查询 DOM。

**Playwright 的限制：**
Playwright 暴露的 `CDPSession` 以 Page 为作用域：

```typescript
// Playwright：session 绑定到 page，不是 frame
const session = await page.context().newCDPSession(page);

// 发送的所有 CDP 命令默认作用于主帧（main frame）
// 没有 frame-scoped session 机制
```

当你需要对特定 iframe 发送 CDP 命令时，Playwright 没有提供直接的 frame 绑定方式，你只能**绕过 Playwright** 直接操作底层 WebSocket。

**原生 CDP 的优雅做法：**

```typescript
// CDP：直接通过 frameId 路由到特定帧
await Runtime.evaluate({
  expression: 'document.querySelector("#target")?.textContent',
  contextId: executionContextId, // 精确指定 frame 的执行上下文
});

// 或通过 DOM domain 的 frameId 参数
await DOM.querySelector({
  nodeId: documentNodeId,
  selector: ".item",
  // CDP 内部根据 nodeId 路由到正确的 frame
});
```

---

### 限制 2：不暴露稳定的 Frame ID

**CDP 原生机制：**
Chrome 为每个 frame 分配全局唯一的 `frameId`（如 `"2F6B3C8D..."`），并通过事件报告生命周期：

- `Page.frameAttached` — 新 frame 附加
- `Page.frameDetached` — frame 移除
- `Page.frameNavigated` — frame 导航完成

**Playwright 的问题：**
Playwright 刻意隐藏这些内部 ID，用自家的 `Frame` 对象抽象：

```typescript
// Playwright：你只能拿到 Frame 对象，拿不到底层 frameId
const frame = page.frame({ name: "my-iframe" });

// 尝试获取 frameId？没有公开 API
// frame._id 是内部属性，不保证稳定，跨版本可能变化
```

**实际痛点：**
当构建"跨 iframe 的元素唯一标识符"（如 `frameId + backendNodeId`）时，你拿不到 Playwright 内部的 `frameId`。当 iframe 重新加载（navigation）后，`Frame` 对象引用会失效（stale），但 Playwright 不会明确通知，你只能被动地 `frameLocator()` 重新获取。

**原生 CDP 的优雅做法：**

```typescript
// 监听 frame 生命周期，维护稳定的 frame 映射
Page.on("frameAttached", (params) => {
  console.log("Frame attached:", params.frameId, params.parentFrameId);
  frameMap.set(params.frameId, { url: params.frame.url });
});

Page.on("frameDetached", (params) => {
  console.log("Frame detached:", params.frameId);
  frameMap.delete(params.frameId);
});

// 用 frameId 精确路由到任意帧
const tree = await Page.getFrameTree();
function collectFrames(tree: any, list: string[] = []) {
  list.push(tree.frame.id);
  if (tree.childFrames) {
    tree.childFrames.forEach((child: any) => collectFrames(child, list));
  }
  return list;
}
const allFrameIds = collectFrames(tree);
```

---

### 限制 3：`backendNodeId` 跨 iframe 不唯一

这是 Stagehand 遇到的**最致命的歧义问题**。

**问题描述：**
CDP 的 DOM 域使用 `backendNodeId`（整数，如 `1234`）引用 DOM 节点。但 `backendNodeId` 是**每个 frame 独立分配**的：

```
iframe A 中某个 div 的 backendNodeId = 42
iframe B 中某个 button 的 backendNodeId = 42  ← 完全不同元素！
```

**Playwright 场景下的灾难：**
当 Playwright 返回 `ElementHandle` 时，它内部知道属于哪个 frame。但当你**绕过 Playwright 直接发送 CDP 命令**时：

```typescript
// 你拿到了 backendNodeId = 42，但 CDP 不知道这是哪个 frame 的 42
await session.send("DOM.describeNode", { backendNodeId: 42 });
// 结果：可能返回错误的元素，或报错
```

Playwright 不暴露 `frameId`，你无法构建 `frameId + backendNodeId` 的复合标识符来消除歧义。

**原生 CDP 的优雅做法：**

```typescript
// 先获取每个 frame 的 document，再分别查询
const tree = await Page.getFrameTree();

async function queryInFrame(frameId: string, selector: string) {
  // 切换到该 frame 的 document root
  const { root } = await DOM.getDocument({ frameId, depth: 0 });
  const { nodeId } = await DOM.querySelector({
    nodeId: root.nodeId,
    selector,
  });
  return { frameId, nodeId }; // 组合标识符全局唯一
}

// 明确知道每个元素来自哪个 frame
for (const child of tree.childFrames || []) {
  const result = await queryInFrame(child.frame.id, ".item");
  console.log(`Found in frame ${result.frameId}: node ${result.nodeId}`);
}
```

---

### 限制 4：跨域 iframe 的 JavaScript 执行限制

**浏览器安全策略：**
跨域 iframe 受同源策略限制，父页面不能直接访问子页面的 `window` 对象或内部变量。

**Playwright 的应对与局限：**
Playwright 可以操作跨域 iframe 的 DOM（点击、输入等），因为它最终也是通过 CDP 在目标 frame 中注入 JavaScript。但问题出在**需要获取 iframe 内部状态**的场景：

```typescript
// Playwright：page.evaluate 默认在主帧执行
const data = await page.evaluate(() => {
  // 这里只能访问主帧的 window
  return window.someGlobalVar; // undefined if it's in iframe
});

// 要在 iframe 中执行，需要切换到 Frame 对象
const frame = page.frame({ url: /cross-origin/ });
const iframeData = await frame.evaluate(() => {
  return window.someGlobalVar;
});
// 但跨域场景下，某些 Frame 操作行为不一致（如 Firefox 的 cross-origin-isolated 报错）
```

**更深层的问题：**
如果你需要直接用 CDP 获取无障碍树（Accessibility Tree）的完整结构——这是 AI Agent 理解页面的关键输入——Playwright 的 frame 抽象层成了阻碍。它把"如何定位到正确的 frame 执行上下文"藏起来了，而你又无法访问它内部维护的映射关系。

**原生 CDP 的优雅做法：**

```typescript
// 获取 Accessibility Tree（包含跨域 iframe 的完整结构）
const { nodes } = await Accessibility.getFullAXTree({
  // 可选：指定 frameId 获取特定帧的树
  // 或获取整页合并后的树
});

// 获取特定 iframe 中的 DOM 快照
const snapshot = await DOMSnapshot.captureSnapshot({
  computedStyles: ["width", "height", "background-color"],
  includePaintOrder: true,
  includeDOMRects: true,
});
// snapshot 包含跨域 iframe 的完整结构，按 frameId 组织
```

---

### 限制 5：iframe 生命周期追踪困难

**场景：动态加载的 iframe**
现代网页经常动态创建/销毁 iframe（如广告、嵌入式组件、微前端）。

**Playwright 的问题：**

```typescript
// Playwright：frames() 返回当前时刻的快照
const frames = page.frames();

// 如果你在遍历过程中 iframe 被销毁了？
for (const frame of frames) {
  try {
    await frame.locator(".ad-banner").click();
  } catch (e) {
    // Error: frame was detached
    // 你只能 catch 后重试，无法预防
  }
}

// 没有事件通知你哪个 frame 何时被添加/移除
// 只能轮询 page.frames() 对比差异
```

**原生 CDP 的优雅做法：**

```typescript
// 实时事件驱动
Page.on("frameAttached", async (params) => {
  console.log("New frame:", params.frameId, params.frame.url);
  // 可以立即对新 frame 执行初始化逻辑
});

Page.on("frameDetached", (params) => {
  console.log("Frame gone:", params.frameId);
  // 清理相关资源
});

Page.on("frameNavigated", (params) => {
  console.log("Frame navigated:", params.frame.id, "→", params.frame.url);
  // 重新初始化该 frame 的上下文
});

// 不需要轮询，事件天然保证时序一致性
```

---

### 限制 6：嵌套 iframe 的复杂定位

**场景：3 层嵌套 iframe**

```
主页面
└── iframe#level-1 (cross-origin)
    └── iframe#level-2 (cross-origin)
        └── iframe#level-3
            └── 目标元素 #deep-target
```

**Playwright 的做法：**

```typescript
// Playwright：链式 frameLocator
const locator = page
  .frameLocator("#level-1")
  .frameLocator("#level-2")
  .frameLocator("#level-3")
  .locator("#deep-target");

await locator.click();

// 问题：每一层 frameLocator 都可能 stale
// 如果 level-2 重新加载了，整个链失效
// 你需要从头重新构建 locator 链
```

**原生 CDP 的优雅做法：**

```typescript
// CDP：通过 frame tree 直接定位
const tree = await Page.getFrameTree();

function findFrame(tree: any, predicate: (f: any) => boolean): string | null {
  if (predicate(tree.frame)) return tree.frame.id;
  if (tree.childFrames) {
    for (const child of tree.childFrames) {
      const found = findFrame(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

// 直接拿到目标 frameId，无需链式 locator
const targetFrameId = findFrame(tree, (f) => f.url.includes("level-3"));

// 在该 frame 中直接执行
await Runtime.evaluate({
  expression: `document.querySelector('#deep-target').click()`,
  contextId: await getExecutionContextId(targetFrameId),
});
```

---

## 三、性能对比：实测数据

### 测试环境

| 项目       | 值                      |
| ---------- | ----------------------- |
| Node.js    | v22.22.2                |
| 操作系统   | macOS (Darwin)          |
| Playwright | ^1.59.1                 |
| CDP 客户端 | chrome-remote-interface |
| 浏览器     | Chromium (headless)     |

### 测试页面

包含 3 个 iframe（50+ 元素/帧，含嵌套 iframe），见 `benchmark/test-page.html`。

### 测试方法与结果

每项测试执行 20 轮取平均值。

| 测试场景                       | Playwright (ms) | 原生 CDP (ms) | Playwright 慢多少 |
| ------------------------------ | --------------- | ------------- | ----------------- |
| 遍历所有 iframe 并统计元素     | 3.73            | 1.82          | **2.05x**         |
| 跨 iframe 按 ID 查询元素       | 8.52            | 4.04          | **2.11x**         |
| 高频获取元素 bounding box      | 19.87           | 0.10          | **203x**          |
| 在各 iframe 中执行 JS 获取数据 | 0.80            | 0.09          | **8.77x**         |

### 关键发现

1. **bounding box 查询差距最大（203x）**
   - Playwright：`elementHandle.boundingBox()` 涉及多次往返：client → server → Chrome → server → client，还要处理等待和重试逻辑
   - CDP：`DOM.getBoxModel({ nodeId })` 单次请求直接返回，无中间层

2. **JS 执行也有近 9x 差距**
   - Playwright 的 `frame.evaluate()` 需要将函数序列化、通过中间层传递、在目标 frame 的反序列化执行
   - CDP 的 `Runtime.evaluate()` 直接发送到 Chrome 的 V8 引擎

3. **遍历和查询操作约 2x 差距**
   - 虽然绝对值不大（毫秒级），但在 AI Agent 高频采集页面状态的场景（每秒数十次查询），累积差距显著

### 架构延迟的根源

```
Playwright 通信路径：
  你的代码
    → Playwright Client Library (序列化)
    → WebSocket
    → Playwright Node.js Server (反序列化、处理、重新序列化)
    → WebSocket
    → Chrome CDP
    → [逆向返回]

原生 CDP 通信路径：
  你的代码
    → WebSocket
    → Chrome CDP
    → [逆向返回]

Playwright 多了一层 Node.js 中间服务器，每次调用都有额外的：
- 序列化/反序列化开销
- 网络往返延迟
- 状态同步开销
```

---

## 四、代码对比：典型场景

### 场景 A：获取页面中所有 iframe 的 URL 列表

**Playwright：**

```typescript
async function getFrameUrls(page: Page): Promise<string[]> {
  const frames = page.frames();
  const urls: string[] = [];
  for (const frame of frames) {
    const url = frame.url();
    urls.push(url);
  }
  return urls;
}
```

**原生 CDP：**

```typescript
async function getFrameUrls(client: CDP.Client): Promise<string[]> {
  const { frameTree } = await client.Page.getFrameTree();
  const urls: string[] = [];

  function traverse(tree: any) {
    urls.push(tree.frame.url);
    if (tree.childFrames) {
      tree.childFrames.forEach(traverse);
    }
  }
  traverse(frameTree);
  return urls;
}
```

**差异：** Playwright 的 `frames()` 返回的是客户端维护的数组快照，而 CDP 的 `getFrameTree()` 直接从浏览器获取，包含更完整的层级信息。

---

### 场景 B：在特定 iframe 中执行 JavaScript 并获取返回值

**Playwright：**

```typescript
async function getItemIndicesInFrame(
  page: Page,
  frameName: string
): Promise<string[]> {
  const frame = page.frame({ name: frameName });
  if (!frame) throw new Error("Frame not found");

  return await frame.evaluate(() => {
    return Array.from(document.querySelectorAll(".item")).map((el) =>
      el.getAttribute("data-index")
    );
  });
}
```

**原生 CDP：**

```typescript
async function getItemIndicesInFrame(
  client: CDP.Client,
  frameId: string
): Promise<string[]> {
  // 获取该 frame 的执行上下文
  const { executionContextId } = await client.Page.createIsolatedWorld({
    frameId,
    worldName: "automation",
  });

  const { result } = await client.Runtime.evaluate({
    expression: `
      Array.from(document.querySelectorAll('.item'))
        .map(el => el.getAttribute('data-index'))
    `,
    contextId: executionContextId,
    returnByValue: true,
  });

  return result.value;
}
```

**差异：** Playwright 通过 frame 对象封装了上下文管理，方便但隐藏了细节。CDP 需要手动管理 `executionContextId`，但提供了更细粒度的控制（如可以创建隔离的 JavaScript world，避免污染页面全局作用域）。

---

### 场景 C：监听 iframe 的网络请求

**Playwright：**

```typescript
async function monitorFrameNetwork(page: Page) {
  // Playwright 的 route 是在 page 级别，无法精确限定到某个 iframe
  await page.route("**/*", (route) => {
    const frame = route.request().frame();
    console.log("Request from frame:", frame?.url(), route.request().url());
    route.continue();
  });
}
```

**原生 CDP：**

```typescript
async function monitorFrameNetwork(client: CDP.Client) {
  await client.Network.enable();

  client.Network.on("requestWillBeSent", (params) => {
    // params.frameId 精确标识请求来自哪个 iframe
    console.log("Request from frame", params.frameId, ":", params.request.url);
  });

  client.Network.on("responseReceived", (params) => {
    console.log(
      "Response for frame",
      params.frameId,
      ":",
      params.response.status,
      params.response.url
    );
  });
}
```

**差异：** Playwright 的 `page.route()` 可以获取 frame 信息，但它是通过请求对象的反向查找，不够直接。CDP 的 `Network` 事件天然携带 `frameId`，可以直接按帧过滤和统计。

---

### 场景 D：构建跨 iframe 的统一 DOM 树（AI Agent 核心需求）

**Playwright（几乎不可行）：**

```typescript
async function buildUnifiedTree(page: Page) {
  const frames = page.frames();
  const trees: any[] = [];

  for (const frame of frames) {
    // 无法获取稳定的 frameId
    // backendNodeId 可能有冲突
    // 只能获取每个 frame 独立的、无法关联的 DOM 信息
    const html = await frame.content();
    trees.push({ url: frame.url(), html });
  }

  // 结果：一堆独立的 HTML 字符串，无法构建跨帧的节点关系图
  return trees;
}
```

**原生 CDP（可行）：**

```typescript
async function buildUnifiedTree(client: CDP.Client) {
  const snapshot = await client.DOMSnapshot.captureSnapshot({
    computedStyles: ["display", "visibility", "opacity"],
    includePaintOrder: true,
    includeDOMRects: true,
  });

  // snapshot 包含：
  // - documents[]: 每个 frame 的文档结构
  // - strings[]: 共享字符串池
  // - layout[]: 布局信息
  // - 通过 documentIndex 关联到对应的 frame

  return snapshot;
}
```

**差异：** Playwright 无法提供跨 iframe 的统一、结构化的 DOM 表示。CDP 的 `DOMSnapshot` 专为这种需求设计，被 Stagehand、Browser Use 等 AI Agent 框架广泛使用。

---

## 五、选择建议

### 选择 Playwright，如果你：

- 编写端到端测试，需要自动等待、重试、截图对比
- 团队以 QA 为主，需要稳定、文档完善的 API
- 不需要深入浏览器内部，常规 DOM 操作足够
- 跨浏览器测试（Playwright 支持 Chromium/Firefox/WebKit）

### 选择原生 CDP，如果你：

- 构建 AI Agent 或高级浏览器自动化框架
- 需要高频采集页面状态（无障碍树、DOM 快照、网络事件）
- 处理复杂的 iframe/跨域场景
- 对延迟敏感，需要直连浏览器
- 需要自定义 CDP 行为（如修改响应头、注入隔离脚本世界）

### 混合方案（Stagehand v3 的做法）：

Stagehand v3 采用了模块化驱动架构：

- 默认使用原生 CDP 驱动获得最佳性能和控制力
- 保留 Playwright 作为可选驱动，兼容已有测试基础设施
- 开发者可以按需切换，不必二选一

---

## 六、结论

Playwright 是优秀的测试框架，但它的抽象层在 AI Agent 和高频自动化场景下成为了瓶颈。核心矛盾在于：

> **Playwright 隐藏浏览器复杂性 → 适合测试开发者**
> **CDP 暴露浏览器全部能力 → 适合自动化框架构建者**

Stagehand、Browser Use 等框架从 Playwright 迁移到原生 CDP，不是因为 Playwright "不好"，而是因为它们的**产品本身就是自动化**，需要在协议层无阻碍地操作浏览器。当你的需求从"测试网页"转变为"让 AI 理解并操控任意网页"时，CDP 是必经之路。

---

## 附录：复现性能测试

```bash
# 安装依赖
pnpm add -D playwright chrome-remote-interface ws @types/ws

# 运行测试
npx tsx benchmark/perf-test.ts

# 查看结果
cat benchmark/results.json
```

测试文件位于 `benchmark/` 目录：

- `test-page.html` — 含多层 iframe 的测试页面
- `perf-test.ts` — 对比测试脚本
- `results.json` — 测试结果（JSON 格式）
