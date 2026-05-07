# browser-agent Specification

## Purpose

TBD - created by archiving change init-browser-agent. Update Purpose after archive.

## Requirements

### Requirement: Agent can perform semantic actions

系统 SHALL 提供 `agent.act(instruction)` API，通过 LLM 工具调用自动完成浏览器操作。

#### Scenario: Login and navigate

- **WHEN** 用户调用 `await agent.act('登录系统', { variables: { username: 'admin', password: '***' } })`
- **THEN** Agent SHALL 自动调用 navigate/fill/press/click 等工具完成登录流程
- **AND** 操作完成后返回，不抛异常

#### Scenario: Action with variables

- **WHEN** 用户传入 `variables: { keyword: '手机' }`
- **THEN** Agent SHALL 在指令中将 `${keyword}` 替换为实际值后执行

### Requirement: Agent supports multi-page operations

系统 SHALL 支持在一个 Browser Context 内管理多个 Page/Tab。

#### Scenario: Open new tab and switch

- **WHEN** Agent 执行操作时页面打开了新 tab
- **THEN** current page SHALL 自动切换到新 tab
- **AND** `tabs` 工具 SHALL 能列出所有 tab 并支持手动切换

### Requirement: Agent uses DeepSeek model

系统 SHALL 使用 DeepSeek 模型驱动 Agent，默认 `deepseek-v4-flash`。

#### Scenario: DeepSeek configuration

- **WHEN** 用户配置 `llm: { apiKey: '...' }` 或不传（默认读 `process.env.DEEPSEEK_API_KEY`）
- **THEN** Agent SHALL 通过 `https://api.deepseek.com` 调用模型
- **AND** `model` 字段默认 `deepseek-v4-flash`，可覆盖
- **AND** 使用 OpenAI 兼容协议（`@ai-sdk/openai` + `baseURL`）
