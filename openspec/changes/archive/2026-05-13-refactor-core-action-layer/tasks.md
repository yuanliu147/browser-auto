## 1. 创建统一 actions 层

- [x] 1.1 在 `packages/core/src/` 下创建 `actions/` 目录
- [x] 1.2 从 `tools/click.ts` 和 `tools/fill.ts` 提取 `resolveTarget()` 逻辑到 `actions/resolve.ts`
- [x] 1.3 实现 `actions/click.ts` —— 接受 `selector` 和/或 `locator`，解析目标，调用 `clickByBackendNodeId`
- [x] 1.4 实现 `actions/fill.ts` —— 接受 `selector`、`locator` 和 `value`，解析目标，调用 `fillByBackendNodeId`
- [x] 1.5 实现 `actions/navigate.ts` —— 接受 `url`，调用 `Page.navigate`，通过 `Page.getFrameTree` 返回实际 URL
- [x] 1.6 实现 `actions/wait.ts` —— 支持 selector 等待（带超时）和固定毫秒等待
- [x] 1.7 实现 `actions/tabs.ts` —— 支持列出、切换和新建标签页操作
- [x] 1.8 创建 `actions/index.ts` 重新导出所有 action 函数

## 2. 重构 tools 以使用 actions 层

- [x] 2.1 更新 `tools/click.ts` 以导入并委托给 `actions/click.ts`，移除内联 `resolveTarget`
- [x] 2.2 更新 `tools/fill.ts` 以导入并委托给 `actions/fill.ts`，移除内联 `resolveTarget`
- [x] 2.3 更新 `tools/navigate.ts` 以导入并委托给 `actions/navigate.ts`，在工具侧保留 `refMap` 清除逻辑
- [x] 2.4 更新 `tools/wait.ts` 以导入并委托给 `actions/wait.ts`
- [x] 2.5 更新 `tools/tabs.ts` 以导入并委托给 `actions/tabs.ts`

## 3. 重构 memory replayer 以使用 actions 层

- [x] 3.1 更新 `memory/replayer.ts` 以从 `actions/` 导入 action 函数
- [x] 3.2 用 `actions/resolve.ts` 的函数替换 `resolveReplayTarget()`
- [x] 3.3 用对 `actions/*` 的直接调用替换 `executeToolOnPage()` 的 switch-case
- [x] 3.4 如不再需要，移除 `executeToolOnPage()` 和 `tryExecuteWithFallback()`，或简化为薄包装
- [x] 3.5 确保 replay 行为与重构前的结果一致（检查点、部分失败、结构性失败）

## 4. 从 CDPPageManager 移除便捷方法

- [x] 4.1 将 `tools/navigate.ts` 中的 `pageManager.navigate()` 调用内联为 `pageManager.send("Page.navigate", { url })`
- [x] 4.2 将 `tools/screenshot.ts` 和 `logger/utils.ts` 中的 `pageManager.screenshot()` 调用内联为 `pageManager.send("Page.captureScreenshot")`
- [x] 4.3 将 `tools/wait.ts` 和 `agent.ts` 中的 `pageManager.evaluate()` 调用内联为 `pageManager.send("Runtime.evaluate", { expression })`
- [x] 4.4 将 `pageManager.getFrameTree()` 调用内联为 `pageManager.send("Page.getFrameTree")`
- [x] 4.5 从 `cdp/page.ts` 删除 `navigate()`、`screenshot()`、`evaluate()`、`getFrameTree()` 方法

## 5. 清理与验证

- [x] 5.1 如仍存在，删除空的 `context/` 目录
- [x] 5.2 在 `packages/core` 上运行 `tsc --noEmit` 以验证无类型错误
- [x] 5.3 运行 `find` + `grep` 确认没有剩余对已移除的 `pageManager.*` 便捷方法的引用
- [x] 5.4 验证 `memory/replayer.ts` 不再直接从 `interaction/` 或 `locator/` 导入（仅通过 `actions/`）
- [x] 5.5 验证所有修改过的文件中没有孤立的 import
- [x] 5.6 运行 `npm run build`（在 `packages/core`）验证能成功编译出 `dist/`
- [x] 5.7 运行 `npm run example`（在根目录）验证核心流程（启动浏览器、执行指令）能正常运行
- [x] 5.8 如 example 运行失败，对比重构前后的行为差异，修复问题后重新验证
