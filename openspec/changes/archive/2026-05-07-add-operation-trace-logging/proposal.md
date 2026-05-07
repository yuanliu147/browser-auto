## Why

当前 `BrowserAgent.act()` 的执行过程对调用方完全不可见——调用后只能看到"完成"或"报错"，无法诊断 Agent 在各步骤中调用了什么工具、遇到了什么错误、页面状态如何变化。这在调试失败任务、优化 Prompt、审计 Agent 行为时造成严重障碍。需要引入结构化的操作过程日志（trace）机制，完整记录每次 `act()` 调用的执行轨迹。

## What Changes

- 新增 `TraceRecorder` 组件，利用 AI SDK v6 的回调钩子采集全链路数据（LLM reasoning、tool calls、tool results、screenshots）
- 扩展 `AgentOptions` 和 `ActOptions` 接口，支持配置 trace 输出目录和截图选项
- 实现会话级目录 + 任务级子目录的日志存储结构
- 对关键工具（click/fill/press/hover/select）的 after 截图增加 100ms 延迟，过滤 UI 过渡态；导航类工具不延迟
- 截图失败时静默跳过，不阻断主任务流程
- 生成三种输出：`trace.json`（结构化全量数据）、`screenshots/`（PNG 文件）、`log.txt`（人类可读摘要）

## Capabilities

### New Capabilities

- `operation-trace`: 操作轨迹记录，支持结构化采集、持久化存储和截图关联

### Modified Capabilities

- `browser-agent`: Agent 的 `act()` 调用 SHALL 支持可选的 trace 记录，`ActOptions` 和 `AgentOptions` SHALL 暴露 trace 配置

## Impact

- `@browser-auto/core` 包新增 `logger/` 模块
- `AgentOptions` 和 `ActOptions` 类型扩展（向后兼容，trace 字段为可选）
- 新增 `fs` 和 `path` 依赖（Node.js 内置模块）
- 无运行时性能影响（trace 未启用时零开销）
