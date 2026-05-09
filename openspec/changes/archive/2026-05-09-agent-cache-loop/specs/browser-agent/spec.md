# browser-agent Specification (Delta)

## Purpose

本文件记录 browser-agent capability 的变更需求。循环驱动方式从 `ai` SDK `generateText` 迁移为自建循环，API 和行为保持不变。

## MODIFIED Requirements

### Requirement: Agent can perform semantic actions

系统 SHALL 提供 `agent.act(instruction)` API，通过 LLM 工具调用自动完成浏览器操作。循环驱动 SHALL 使用自建循环实现，直接调用 LLM API。

#### Scenario: Login and navigate

- **WHEN** 用户调用 `await agent.act('登录系统', { variables: { username: 'admin', password: '***' } })`
- **THEN** Agent SHALL 自动调用 navigate/fill/press/click 等工具完成登录流程
- **AND** 操作完成后返回，不抛异常

#### Scenario: Action with variables

- **WHEN** 用户传入 `variables: { keyword: '手机' }`
- **THEN** Agent SHALL 在指令中将 `${keyword}` 替换为实际值后执行

#### Scenario: Action with trace enabled at Agent level

- **WHEN** 用户创建 Agent 时传入 `trace: { outputDir: './traces' }`
- **AND** 调用 `await agent.act('登录系统')`
- **THEN** Agent SHALL 在执行过程中采集 LLM reasoning、工具调用和截图
- **AND** 执行完成后 SHALL 在 `./traces/001-登录系统-143205/` 目录下生成 `trace.json`、`log.txt` 和 `screenshots/`

### Requirement: Agent uses DeepSeek model

系统 SHALL 使用 DeepSeek 模型驱动 Agent，默认 `deepseek-v4-flash`。SHALL 通过自建循环直接调用 LLM API，不再依赖 `ai` SDK。

#### Scenario: DeepSeek configuration

- **WHEN** 用户配置 `llm: { apiKey: '...' }` 或不传（默认读 `process.env.DEEPSEEK_API_KEY`）
- **THEN** Agent SHALL 通过自建循环调用 `https://api.deepseek.com` 的 chat completions API
- **AND** `model` 字段默认 `deepseek-v4-flash`，可覆盖
- **AND** 使用 OpenAI 兼容的 function calling 协议
