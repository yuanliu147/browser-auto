## 1. CDP 连接层

- [x] 1.1 移除 `playwright` 依赖，添加 `ws`（WebSocket 客户端）到 `packages/core/package.json`
- [x] 1.2 实现 `packages/core/src/cdp/client.ts`
- [x] 1.3 实现 `packages/core/src/cdp/browser.ts`
- [x] 1.4 实现 `packages/core/src/cdp/page.ts`
- [x] 1.5 实现生命周期管理
- [x] 1.6 验证：benchmark 用例确认 CDP 连接正常

## 2. 快照系统

- [x] 2.1 实现 `packages/core/src/snapshot/axtree.ts`
- [x] 2.2 实现 `packages/core/src/snapshot/domsnapshot.ts`
- [x] 2.3 实现 `packages/core/src/snapshot/adapter.ts`
- [x] 2.4 实现 `packages/core/src/snapshot/serializer.ts`
- [x] 2.5 验证：对中后台表单页面生成快照（test-form-automation.ts 通过）

## 3. 语义元素定位

- [x] 3.1 实现 `packages/core/src/locator/types.ts`
- [x] 3.2 实现 `packages/core/src/locator/find.ts`
- [x] 3.3 实现 `packages/core/src/locator/extract.ts`
- [x] 3.4 验证：在复杂表单页面上测试定位回退链（test-form-automation.ts 通过）

## 4. 上下文路径系统

- [x] 4.1 实现 `packages/core/src/context/types.ts`
- [x] 4.2 实现 `packages/core/src/context/enter.ts`
- [x] 4.3 实现 `packages/core/src/context/match.ts`
- [x] 4.4 验证：在嵌套 iframe + shadow DOM 的测试页上验证
  - Shadow DOM：Accessibility Tree 可穿透捕获，但工具层尚未接入 contextPath 无法操作
  - iframe：Accessibility Tree 不跨 frame，需要 frame session 切换才能捕获和操作

## 5. 工具重写

- [x] 5.1 重写 `navigate` 工具
- [x] 5.2 重写 `click` 工具
- [x] 5.3 重写 `fill` 工具
- [x] 5.4 重写 `getSnapshot` 工具
- [x] 5.5 重写 `screenshot` 工具
- [x] 5.6 简化 `waitFor` 工具
- [x] 5.7 保留 `tabs` 和 `submitDone` 工具
- [x] 5.8 删除 `press`、`hover`、`select`、`scroll`、`getText` 工具
- [x] 5.9 更新 `packages/core/src/tools/index.ts`
- [x] 5.10 更新 `packages/core/src/prompts/system.ts`
- [x] 5.11 验证：`examples/test-login.ts` 运行成功

## 6. 记忆系统适配

- [x] 6.1 重写 `packages/core/src/memory/extractor.ts`
- [x] 6.2 重写 `packages/core/src/memory/replayer.ts`
- [x] 6.3 更新 `MemorizedPath` 类型
- [x] 6.4 验证：成功执行一次表单操作 → 提取路径 → 同一页面 replay（test-memory-replay.ts 通过，replay 耗时 679ms vs LLM 105987ms）

## 7. Agent 层适配

- [x] 7.1 重写 `packages/core/src/browser/index.ts`
- [x] 7.2 更新 `BrowserAgent` 构造函数
- [x] 7.3 更新 `createBrowserAgent` 工厂函数
- [x] 7.4 验证：`examples/test-login.ts` 完整运行成功

## 8. 回归验证

- [x] 8.1 运行 benchmark 用例，CDP 性能优异（bounding box 快 182x，frame eval 快 10x）
- [x] 8.2 在含 iframe 的测试页上验证 Agent（基本表单操作通过，iframe 内操作需 frame session 支持）
- [x] 8.3 验证 trace 系统仍能正确记录 CDP 工具调用（test-form-automation.ts trace 输出验证通过）
- [x] 8.4 清理 Playwright 残留代码和未使用的依赖
