## MODIFIED Requirements

### Requirement: Trace records full execution trajectory

系统 SHALL 为每次 `act()` 调用生成完整的结构化执行轨迹（trace），包含所有 LLM 推理步骤、工具调用及其结果。

#### Scenario: Successful trace generation

- **WHEN** 用户调用 `agent.act('登录系统')` 且 Agent 已启用 trace
- **THEN** 系统 SHALL 生成包含 `traceId`、`instruction`、`startedAt`、`endedAt`、`steps` 的 `trace.json`
- **AND** `steps` SHALL 包含每个 LLM step 的 `stepNumber`、`reasoningText`、`toolCalls`
- **AND** 每个 `toolCall` SHALL 包含 `toolName`、`args`、`result`、`success`、`durationMs`

### Requirement: Trace supports screenshot association

系统 SHALL 对关键工具的操作前后进行截图，并在 trace 中记录截图文件路径。

#### Scenario: Screenshot for interaction tools

- **WHEN** Agent 调用 `click`、`fill` 工具
- **THEN** 系统 SHALL 在工具执行前截取 `screenshotBefore`
- **AND** 系统 SHALL 在工具执行后延迟 100ms 截取 `screenshotAfter`
- **AND** 两张截图 SHALL 保存为外置 PNG 文件
- **AND** `trace.json` SHALL 通过相对路径引用这些文件

#### Scenario: No screenshot for read-only tools

- **WHEN** Agent 调用 `getSnapshot`、`screenshot`、`waitFor`、`submitDone` 工具
- **THEN** 系统 SHALL 不生成 before/after 截图

#### Scenario: Screenshot failure handling

- **WHEN** 截图时页面处于导航中或其他原因导致截图失败
- **THEN** 系统 SHALL 静默跳过该截图
- **AND** 在 `trace.json` 中标记 `screenshotBefore: null` 或 `screenshotAfter: null`
- **AND** 主任务 SHALL 继续执行，不抛异常

### Requirement: Trace supports configurable output directory

系统 SHALL 支持通过 `AgentOptions` 配置 trace 的输出根目录。每次 `act()` 调用 SHALL 在根目录下自动生成独立的、以指令摘要命名的子目录。

#### Scenario: Agent-level trace enabled

- **WHEN** 用户在 `AgentOptions` 中配置 `trace: { outputDir: './traces' }`
- **AND** 调用 `agent.act('登录系统')`
- **THEN** trace SHALL 输出到 `./traces/001-登录系统-143205/` 目录
- **AND** 目录名 SHALL 包含序号、指令摘要和时间戳

#### Scenario: Multiple acts in same session

- **WHEN** 用户在 `AgentOptions` 中配置 `trace: { outputDir: './traces' }`
- **AND** 先调用 `agent.act('登录系统')`
- **AND** 再调用 `agent.act('搜索商品')`
- **THEN** 两个 trace SHALL 分别输出到 `./traces/001-登录系统-143205/` 和 `./traces/002-搜索商品-143312/`
- **AND** 序号 SHALL 在 Agent 实例内自增

#### Scenario: Agent-level trace disabled

- **WHEN** 用户创建 Agent 时不传 `trace` 字段
- **THEN** 所有 `act()` 调用 SHALL 不生成任何 trace 文件
- **AND** 系统 SHALL 不注册 AI SDK 回调
- **AND** 执行性能 SHALL 与修改前完全一致

### Requirement: Trace generates human-readable log

系统 SHALL 同时生成纯文本摘要 `log.txt`，便于快速浏览执行过程。

#### Scenario: Log content

- **WHEN** trace 生成完成
- **THEN** `log.txt` SHALL 包含时间戳、步骤序号、工具名、参数、执行结果、截图引用
- **AND** 格式 SHALL 为每行一个事件的纯文本日志

### Requirement: Trace has zero overhead when disabled

系统 SHALL 在 trace 未启用时不对执行性能产生任何影响。

#### Scenario: No trace config

- **WHEN** 用户创建 Agent 时不传 `trace` 字段
- **THEN** 系统 SHALL 不创建任何文件
- **AND** 系统 SHALL 不注册 AI SDK 回调
- **AND** 执行性能 SHALL 与修改前完全一致

## ADDED Requirements

### Requirement: Trace captures refMap for memory extraction

系统 SHALL 在 trace 中记录每次 snapshot 生成的 `refMap`，使 `extractMinimalPath` 能将 `ref` 参数反解为完整的 `ElementLocator`。

#### Scenario: refMap recorded in trace step

- **WHEN** `getSnapshot` 工具执行完成
- **THEN** trace 的对应 step SHALL 记录 `refMap` 的快照
- **AND** `refMap` SHALL 包含所有 `@eN` 到 `ElementLocator` 的映射

#### Scenario: extractMinimalPath resolves ref to locator

- **WHEN** `extractMinimalPath` 处理包含 `ref` 参数的 tool call
- **THEN** 系统 SHALL 从 trace 中查找对应 step 的 `refMap`
- **AND** SHALL 将 `ref` 反解为完整的 `ElementLocator`
- **AND** 缓存的 `PathStep.locator` SHALL 包含多策略定位信息

#### Scenario: Trace refMap missing

- **WHEN** `extractMinimalPath` 遇到 `ref` 参数但 trace 中无对应 `refMap`
- **THEN** 系统 SHALL 降级到从 `selector` 参数提取 locator
- **AND** 若两者皆无 SHALL 跳过该 step 的 locator 提取
