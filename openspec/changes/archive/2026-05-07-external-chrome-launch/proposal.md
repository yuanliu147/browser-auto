## Why

当前 `browser-agent` 使用 Playwright 的 `launchPersistentContext` 启动 Chrome，这会自动注入 `--enable-automation` 等标记，导致网站可以通过 `navigator.webdriver` 等特征检测到自动化操作。在需要避免反爬/反自动化检测的场景下，这种方式不可接受。

## What Changes

- **BREAKING**: `createBrowserContext` 不再使用 `launchPersistentContext` 启动 Chrome
- 新增外部 Chrome 进程启动机制：当 `connectOverCDP` 复用失败时，通过 `child_process.spawn` 直接启动系统 Chrome（不经过 Playwright）
- 新增 CDP 端口就绪等待逻辑，确保 Chrome 初始化完成后再连接
- 新增跨平台 Chrome 路径查找（macOS / Linux / Windows）
- `ownsBrowser` 标记语义不变：自己启动的 Chrome 在关闭时负责杀掉，复用的 Chrome 不杀掉

## Capabilities

### New Capabilities

- `chrome-launch`: 定义系统 Chrome 的查找、启动、CDP 连接和生命周期管理

### Modified Capabilities

- （无 spec 级行为变更，仅 browser-agent 的实现方式改变）

## Impact

- `packages/core/src/browser/index.ts`：完全重写 Chrome 启动逻辑
- `packages/core/src/browser/`：可能新增 `chrome-path.ts` 等平台相关工具模块
- 无 API 变更，用户侧代码无需修改
