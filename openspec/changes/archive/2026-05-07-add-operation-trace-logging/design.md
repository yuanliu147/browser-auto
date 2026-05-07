## Context

当前 `BrowserAgent` 使用 AI SDK v6 的 `generateText` 驱动工具调用，但执行过程对调用方完全不可见。`generateText` 本身提供了丰富的回调钩子（`experimental_onToolCallStart`、`experimental_onToolCallFinish`、`onStepFinish`、`onFinish`），但这些钩子当前未被利用。同时，13 个浏览器工具通过 `createBrowserTools` 统一注册，工具层具备截图能力（通过 `PageManager` 获取当前页面）。

本设计利用 AI SDK 的原生回调机制 + Playwright 截图能力，在不侵入工具核心逻辑的前提下，实现全链路操作日志采集。

## Goals / Non-Goals

**Goals:**

- 每次 `act()` 调用可选生成完整的结构化执行轨迹
- 轨迹包含：LLM reasoning、工具调用（参数+结果+耗时）、截图（before/after）
- 轨迹持久化到文件系统：JSON 全量数据 + PNG 截图 + 纯文本摘要
- trace 开关和输出目录统一由 `AgentOptions` 配置，所有 `act()` 调用共享
- 未启用 trace 时零运行时开销

**Non-Goals:**

- 不实现日志的实时流式输出（不推送到 WebSocket/HTTP）
- 不实现轨迹的 Web UI 回放（仅生成文件，消费端另议）
- 不修改现有工具的 execute 逻辑（仅通过回调拦截）
- 不实现日志压缩/归档/自动清理策略
- 不等待页面"完全加载稳定"后再截图（只延迟 100ms 过滤 UI 过渡态）

## Decisions

### Decision 1: 日志采集基于 AI SDK 回调，而非工具层侵入

**选择**：利用 `generateText` 的 `experimental_onToolCallStart`、`experimental_onToolCallFinish`、`onStepFinish`、`onFinish` 采集数据，工具层不添加日志代码。

**理由**：

- AI SDK 回调天然提供 LLM reasoning、tool call 参数、执行结果、耗时等完整信息
- 工具层零改动，降低维护成本和回归风险
- `onToolCallStart`/`onToolCallFinish` 的调用时机正好包围 `execute()`，适合截图

**替代方案**：在每个工具的 `execute` 函数里手动注入日志代码。拒绝原因：需要修改 13 个工具文件，耦合度高，且拿不到 LLM 的 reasoning 文本。

### Decision 2: Agent 级别统一配置，每次 `act()` 自动生成独立 trace 目录

**选择**：`AgentOptions.trace` 控制是否启用 trace 及输出根目录。每次 `act()` 调用时，`TraceRecorder` 内部自动生成以指令摘要命名的独立子目录。

**理由**：

- Agent 实例对应一个会话，会话级统一配置符合心智模型
- 单次 `act()` 是一个独立的任务单元，有独立的指令和步骤序列，天然需要独立的 trace 目录
- 调用方无负担，使用 `agent.act("登录")` 即可，trace 目录自动命名为 `001-登录-143205`

**目录命名规则**：`{seq}-{instruction-slug}-{HHMMSS}`

- `seq`：Agent 实例内自增序号（001, 002...）
- `instruction-slug`：指令前 15 个字符的 URL-safe 版本（中文保留，空格转连字符，特殊字符移除）
- `HHMMSS`：调用时的时间戳

**示例**：

```
./traces/
├── 001-登录系统-143205/
│   ├── trace.json
│   ├── log.txt
│   └── screenshots/
└── 002-搜索商品-143312/
    ├── trace.json
    ├── log.txt
    └── screenshots/
```

### Decision 3: 截图按工具类型差异化延迟

**选择**：交互类工具（click/fill/press/hover/select）after 截图延迟 100ms，导航类（navigate）和标签类（tabs）不延迟。

**理由**：

- 交互操作的 UI 过渡态（active、focus）通常在 100ms 内消退，延迟有价值
- navigate 的页面加载时间不可预测（200ms-5s），100ms 杯水车薪，且 navigate 后截图失败率高
- scroll 不改变页面内容，仅改变视口，过渡态问题小

**替代方案**：统一延迟 100ms 或完全不延迟。拒绝原因：统一延迟对 navigate 无意义且增加失败率；完全不延迟则交互操作的 after 图质量差。

### Decision 4: 截图失败静默跳过，不阻断主流程

**选择**：所有截图操作包裹 try/catch，失败时记录 `screenshotAfter: null` 并带 reason，任务继续执行。

**理由**：

- navigate 后页面 unloading 时截图抛错是预期行为，不应导致任务失败
- 日志是观测设施，不能影响被观测系统的正确性

### Decision 5: 截图存储为外置 PNG 文件，JSON 存引用路径

**选择**：截图保存为独立 PNG 文件，trace.json 中存储相对路径字符串。

**理由**：

- base64 内联会让 JSON 文件巨大且不可读
- 外置文件可用图片查看器直接打开，方便调试
- 路径引用保持 JSON 的可解析性

### Decision 6: 不在 ActOptions 暴露 trace 配置，统一由 Agent 级别管理

**选择**：`ActOptions` 不暴露任何 trace 相关配置。trace 的开关和输出目录统一由 `AgentOptions` 控制，所有 `act()` 调用共享同一套行为。

**理由**：

- 降低调用方认知负担，使用 `agent.act("登录")` 即可，无需关注日志细节
- 一个 Agent 实例通常对应一个会话，会话级统一配置更符合心智模型
- 避免每次调用时重复传相同的 trace 配置

**替代方案**：在 ActOptions 支持 trace 覆盖。拒绝原因：增加了调用方负担，且实际场景中单次 Agent 会话内的多个 act() 通常需要一致的日志策略。

### Decision 7: trace 输出采用简单文件写入，预留 TODO 扩展点

**选择**：当前仅实现本地文件系统输出（trace.json + log.txt + screenshots/）。不在代码中引入 `TraceSink`/`ScreenshotStorage` 等接口抽象，仅在关键位置留 TODO 注释标记未来扩展方向。

**理由**：

- 当前需求明确且单一（本地文件持久化），引入接口抽象属于过度设计
- TODO 注释足够指导后续开发者在需要时添加远程上传、对象存储等能力
- 保持代码简洁，避免为 hypothetical 的未来需求增加复杂度

**TODO 位置规划**：

- `TraceRecorder.flush()` 附近：标记未来可替换为不同的输出目标（HTTP、S3 等）
- 截图保存逻辑附近：标记未来可支持上传到 OSS 后返回 URL
- `AgentOptions.trace` 附近：标记未来可支持更丰富的配置（采样率、过滤规则等）

## Risks / Trade-offs

- **[Risk] 截图累积磁盘占用** → 单次任务 20 步关键操作 × 2 张图 ≈ 40 张 PNG，按 100KB/张估算约 4MB/任务。Mitigation：截图可配置关闭；长期看需另设清理策略（本次不实现）。
- **[Risk] after 截图拍到 loading/过渡态** → 100ms 延迟不能解决异步数据加载问题。Mitigation：这是已知限制，文档中明确说明；如需"稳定后"截图，后续可扩展为等待特定选择器出现。
- **[Risk] 多 act() 并发时的序号冲突** → 当前设计假设单线程顺序调用。Mitigation：trace 目录使用 UUID + 时间戳，即使并发也不冲突；序号仅用于人类可读性，非唯一标识。
- **[Trade-off] 截图延迟增加总执行时间** → 20 步 × 100ms = 2s 额外开销。接受此 trade-off，因为调试场景对时间不敏感，且可通过 `screenshotDelayMs: 0` 关闭。

## Migration Plan

- 无迁移需求。trace 字段为可选，现有代码不传 `trace` 时行为完全不变。

## Open Questions

（无）
