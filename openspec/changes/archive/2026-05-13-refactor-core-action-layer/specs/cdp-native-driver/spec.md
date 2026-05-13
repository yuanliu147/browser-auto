## 修改的需求

### 需求：系统可以获取 frame tree 用于上下文导航

系统 SHALL 通过 CDP `Page.getFrameTree` 获取完整的 frame 树结构，用于 iframe 上下文定位。

#### 场景：从主页面获取 frame tree

- **WHEN** 系统调用获取 frame tree
- **THEN** 系统 SHALL 通过 `pageManager.send("Page.getFrameTree")` 获取数据
- **AND** SHALL 返回包含主帧和所有子帧的树形结构
- **AND** 每个帧 SHALL 包含 `frameId`、`url`、`name` 和 `parentFrameId`

### 需求：系统可以在指定的 execution context 中执行 JavaScript

系统 SHALL 通过 CDP `Runtime.evaluate` 在指定的 execution context 中执行 JavaScript，支持主页面和 iframe。

#### 场景：在主帧中执行

- **WHEN** 系统发送 `Runtime.evaluate` 不指定 `contextId`
- **THEN** 系统 SHALL 通过 `pageManager.send("Runtime.evaluate", { expression })` 执行
- **AND** SHALL 在主帧的默认 execution context 中执行

#### 场景：在 iframe 中执行

- **WHEN** 系统指定 `contextId` 为某 iframe 的 execution context
- **THEN** 系统 SHALL 通过 `pageManager.send("Runtime.evaluate", { expression, contextId })` 执行
- **AND** SHALL 在该 iframe 中执行 JavaScript

## 移除的需求

### 需求：CDPPageManager 暴露便捷导航方法

**原因**：便捷方法（`navigate`、`screenshot`、`evaluate`、`getFrameTree`）增加了 API 表面积却没有提供真正的抽象。调用方现在直接使用 `pageManager.send()`。
**迁移**：将 `pageManager.navigate(url)` 替换为 `pageManager.send("Page.navigate", { url })`；将 `pageManager.screenshot()` 替换为 `pageManager.send("Page.captureScreenshot")`；将 `pageManager.evaluate(expr)` 替换为 `pageManager.send("Runtime.evaluate", { expression: expr })`；将 `pageManager.getFrameTree()` 替换为 `pageManager.send("Page.getFrameTree")`。
