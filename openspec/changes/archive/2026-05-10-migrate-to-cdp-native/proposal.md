## Why

当前系统基于 Playwright 驱动浏览器，在 AI Agent 高频采集页面状态、处理复杂 iframe 嵌套、构建统一 DOM 快照等场景下遇到性能和控制的瓶颈。基于 benchmark 实测（bounding box 查询 CDP 比 Playwright 快 203x，JS 执行快 9x），以及 Playwright 在 iframe 生命周期追踪、shadow DOM、跨域控制等方面的结构性限制，需要将底层驱动从 Playwright 迁移到原生 Chrome DevTools Protocol (CDP)，以支撑中后台表单中长流程自动化的可靠性。

## What Changes

- **BREAKING**: 移除 Playwright 作为浏览器驱动，全面切换到原生 CDP WebSocket 连接
- **BREAKING**: 精简工具集，删除 press、hover、select、scroll、getText 等工具；保留 navigate、click、fill、getSnapshot、screenshot、submitDone、waitFor（简化）、tabs
- **BREAKING**: 元素定位从 CSS selector 主标识改为语义标识（label-text > aria-label > structure > xpath），缓存系统不再依赖 backendNodeId
- 新增 CDP 原生页面快照系统（Accessibility Tree + DOMSnapshot 混合），输出内部结构化 JSON + LLM 紧凑文本
- 新增可插拔组件类型 Adapter 机制（AntD / Element / 自定义）
- 新增上下文路径系统（ContextPath），支持 iframe / shadow DOM / modal 的任意深度嵌套定位与缓存 replay
- 重构记忆系统的 replay 机制，支持跨上下文（frame/shadow）的操作路径复用
- 保留现有 Agent Loop、Trace、变量替换等上层能力不变

## Capabilities

### New Capabilities

- `cdp-native-driver`: CDP 原生浏览器驱动，负责 Chrome 启动、CDP WebSocket 连接、会话管理、页面上下文获取
- `snapshot-format`: 页面快照格式与生成，包括 CDP Accessibility Tree 提取、DOMSnapshot 采集、组件类型推断、LLM 紧凑文本序列化
- `semantic-element-locator`: 语义元素定位系统，基于 label-text、aria-label、placeholder、结构位置等多策略回退定位
- `context-path-system`: 上下文路径系统，支持 main/frame/shadow/modal 的嵌套进入、缓存、replay 时的上下文恢复

### Modified Capabilities

- `browser-agent`: 驱动方式从 Playwright 改为 CDP；工具集精简（移除 press/hover/select/scroll/getText）；getSnapshot 工具改为 CDP 原生快照
- `agent-cache-loop`: 缓存路径中的元素标识从 CSS selector 改为语义标识 + 上下文路径（ContextPath）；replay 时支持跨 frame/shadow 的上下文进入与恢复；selector fallback 策略改为语义 fallback

## Impact

- `packages/core/src/browser/`: 全面重构，移除 Playwright 依赖，改为 CDP 连接管理
- `packages/core/src/tools/`: 删除 5 个工具，重写 click/fill/getSnapshot 为 CDP 实现
- `packages/core/src/memory/`: 重写 extractor 和 replayer，支持语义标识和 ContextPath
- `packages/core/src/loop/`: 基本不变，但 tool descriptions 和 system prompt 需更新
- `packages/core/src/prompts/`: system prompt 更新工具列表
- `docs/`, `benchmark/`: 保留已有文档和 benchmark，作为架构决策参考
- 外部依赖：移除 `playwright`，新增 `chrome-remote-interface` 或原生 `ws` + CDP 协议实现
