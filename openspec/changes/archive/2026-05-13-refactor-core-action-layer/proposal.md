## 背景

`core` 包中存在重复的执行逻辑：`tools/`（click、fill、navigate）和 `memory/replayer.ts` 各自独立地解析元素定位器并分发浏览器动作。这种重复导致行为分叉（例如 navigate 工具会清除 `refMap`，而 replay 不会），增加了维护成本。同时 `cdp/page.ts` 累积了一些便捷包装方法（`navigate`、`screenshot`、`evaluate`），它们只是对 `send()` 的薄封装——增加了 API 表面积却没有提供真正的抽象。我们需要一个浏览器动作的单一真相源，以及一个更精简的 CDP 管理器。

## 变更内容

- **创建 `actions/` 层** — 将原子浏览器操作（click、fill、navigate、wait）提取到统一层，供 `tools/` 和 `memory/replayer.ts` 共同消费。
- **移除重复的 `resolveTarget` / `executeToolOnPage` 逻辑** — `tools/click.ts`、`tools/fill.ts` 和 `memory/replayer.ts` 目前各自维护平行的定位器解析和动作分发代码，它们将委托给 `actions/`。
- **对齐 replay 和 tool 的行为** — Replayer 将使用与 LLM 工具相同的动作原语，消除隐藏的行为差异（如 refMap 生命周期、URL 返回值）。
- **移除 `cdp/page.ts` 中的便捷方法** — 删除 `navigate()`、`screenshot()`、`evaluate()`、`getFrameTree()`。所有调用方直接切换到 `pageManager.send()`。这将 `CDPPageManager` 恢复为纯 CDP 会话路由器。
- **清理空目录** — 删除目前为空的 `context/` 目录。

## 能力

### 新增能力

- `unified-browser-action-layer`：集中的浏览器动作原语（click、fill、navigate、wait），供工具执行回调和 memory replayer 共同使用。

### 修改的能力

- `cdp-native-driver`：`CDPPageManager` 失去便捷包装方法；调用方使用原始 `send()` 调用。外部 API 无变化。
- `agent-cache-loop`：Memory replay 现在委托给统一动作层，而不是重新实现工具执行逻辑。

## 影响范围

- 仅影响 `packages/core/src/` 的内部结构。公开的 `BrowserAgent` API 无变化。
- 所有 `tools/*` 文件将大幅缩减，因为执行逻辑迁移到 `actions/`。
- `memory/replayer.ts` 将依赖 `actions/`，而不是直接调用 `interaction/` 和 `locator/`。
- 引用已移除的 `pageManager.*` 便捷方法的测试（如有）需要更新。
