## MODIFIED Requirements

### Requirement: Agent can perform semantic actions

系统 SHALL 提供 `agent.act(instruction)` API，通过 LLM 工具调用自动完成浏览器操作。循环驱动 SHALL 使用自建循环实现，直接调用 LLM API。

#### Scenario: Login and navigate

- **WHEN** 用户调用 `await agent.act('登录系统', { variables: { username: 'admin', password: '***' } })`
- **THEN** Agent SHALL 自动调用 navigate/fill/click 等工具完成登录流程
- **AND** 操作完成后返回，不抛异常

#### Scenario: Action with trace enabled at Agent level

- **WHEN** 用户创建 Agent 时传入 `trace: { outputDir: './traces' }`
- **AND** 调用 `await agent.act('登录系统')`
- **THEN** Agent SHALL 在执行过程中采集 LLM reasoning、工具调用和截图
- **AND** 执行完成后 SHALL 在 `./traces/001-登录系统-143205/` 目录下生成 `trace.json`、`log.txt` 和 `screenshots/`

### Requirement: Agent supports multi-page operations

系统 SHALL 支持在一个 Browser Context 内管理多个 Page/Tab。

#### Scenario: Open new tab and switch

- **WHEN** Agent 执行操作时页面打开了新 tab
- **THEN** current page SHALL 自动切换到新 tab
- **AND** `tabs` 工具 SHALL 能列出所有 tab 并支持手动切换

### Requirement: Agent uses DeepSeek model

系统 SHALL 使用 DeepSeek 模型驱动 Agent，默认 `deepseek-v4-flash`。SHALL 通过自建循环直接调用 LLM API，不再依赖 `ai` SDK。

#### Scenario: DeepSeek configuration

- **WHEN** 用户配置 `llm: { apiKey: '...' }` 或不传（默认读 `process.env.DEEPSEEK_API_KEY`）
- **THEN** Agent SHALL 通过自建循环调用 `https://api.deepseek.com` 的 chat completions API
- **AND** `model` 字段默认 `deepseek-v4-flash`，可覆盖
- **AND** 使用 OpenAI 兼容的 function calling 协议

## ADDED Requirements

### Requirement: Tool interface supports context parameter

系统 SHALL 将 `Tool.execute` 接口从 `(args) => Promise<unknown>` 扩展为 `(args, context) => Promise<unknown>`，使工具能访问 `pageManager` 和 `refMap`。

#### Scenario: click tool receives context with refMap

- **WHEN** `AgentLoop` 调用 `click` 工具
- **THEN** `execute` SHALL 收到 `args` 和 `context: { pageManager, refMap }`
- **AND** `context.refMap` SHALL 包含当前 snapshot 的最新 ref 映射

#### Scenario: Non-interactive tools ignore context

- **WHEN** `navigate`、`screenshot`、`waitFor` 等工具被调用
- **THEN** 这些工具 SHALL 正常执行
- **AND** 即使不使用 `context` 参数 SHALL 保持兼容性

### Requirement: click tool supports ref parameter

`click` 工具 SHALL 支持通过 `ref` 参数精确引用 snapshot 中的元素。

#### Scenario: Click by ref

- **WHEN** LLM 返回 `click({ ref: 'e2' })`
- **AND** `context.refMap.get('e2')` 存在
- **THEN** 系统 SHALL 通过 `locateElement()` 解析元素
- **AND** SHALL 使用 CDP Input 事件完成点击

#### Scenario: Click by selector fallback

- **WHEN** LLM 返回 `click({ selector: '#loginBtn' })`
- **THEN** 系统 SHALL 使用 CSS selector 定位元素
- **AND** SHALL 使用 CDP Input 事件完成点击

#### Scenario: click tool rejects text parameter

- **WHEN** LLM 返回包含 `text` 参数的 `click` 调用
- **THEN** 系统 SHALL 拒绝该参数
- **AND** SHALL 返回错误提示 "text parameter removed, use ref or selector"

### Requirement: fill tool supports ref parameter

`fill` 工具 SHALL 支持通过 `ref` 参数精确引用 snapshot 中的输入元素。

#### Scenario: Fill by ref

- **WHEN** LLM 返回 `fill({ ref: 'e3', value: 'admin' })`
- **AND** `context.refMap.get('e3')` 存在
- **THEN** 系统 SHALL 通过 `locateElement()` 解析元素
- **AND** SHALL 使用 CDP Input 事件完成填充

#### Scenario: Fill by selector fallback

- **WHEN** LLM 返回 `fill({ selector: '#username', value: 'admin' })`
- **THEN** 系统 SHALL 使用 CSS selector 定位元素
- **AND** SHALL 使用 CDP Input 事件完成填充

### Requirement: getSnapshot tool exposes refMap

`getSnapshot` 工具 SHALL 在返回 snapshot 文本的同时，将 `refMap` 注入到 `ToolContext` 供后续工具使用。

#### Scenario: Snapshot generates refMap

- **WHEN** `getSnapshot` 执行完成
- **THEN** 返回的 snapshot 文本 SHALL 包含 `@eN` 标注
- **AND** `context.refMap` SHALL 被更新为当前 snapshot 的映射

### Requirement: Agent handover uses snapshot instead of innerText

当 memory replay 部分失败需要 handover 给 LLM 时，系统 SHALL 使用 `getSnapshot()` 获取结构化页面信息，而非 `document.body.innerText`。

#### Scenario: Partial replay handover

- **WHEN** memory replay 部分成功，剩余步骤需要 LLM 接管
- **THEN** `runWithHandover` SHALL 调用 `getSnapshot()` 获取当前页面状态
- **AND** handover 消息 SHALL 包含带 ref 的 snapshot 文本
- **AND** LLM SHALL 能继续使用 ref 完成剩余操作

## REMOVED Requirements

### Requirement: Agent provides press tool

**Reason**: CDP 直接操控 DOM，不需要模拟键盘事件。Enter 提交可通过 click 提交按钮或 dispatchEvent 实现，Tab 跳转可通过 focus 管理实现。
**Migration**: 移除 press 工具，相关操作改用 click 或 CDP Runtime.evaluate。

### Requirement: Agent provides hover tool

**Reason**: 中后台表单场景极少用到 hover；需要悬停触发的 tooltip 可用 click 或 focus 替代。
**Migration**: 移除 hover 工具。

### Requirement: Agent provides select tool

**Reason**: 现代中后台系统（AntD / Element）不使用原生 `<select>`，自定义下拉组件需要用 click + fill 组合操作。
**Migration**: 移除 select 工具；下拉选择场景由 LLM 通过 click 展开 + click 选项完成。

### Requirement: Agent provides scroll tool

**Reason**: CDP DOMSnapshot 可获取完整页面结构（包括视口外元素），无需显式滚动；如需聚焦特定区域，可通过 Runtime.evaluate 直接 scrollIntoView。
**Migration**: 移除 scroll 工具。

### Requirement: Agent provides getText tool

**Reason**: 文本读取可合并到 getSnapshot 的限定范围查询中；snapshot 支持 selector 限定后，无需独立 getText 工具。
**Migration**: 移除 getText 工具；需要读取特定元素文本时，getSnapshot 支持传入 scope selector 返回局部快照。
