## MODIFIED Requirements

### Requirement: Agent can perform semantic actions

系统 SHALL 提供 `agent.act(instruction, options)` API，通过 LLM 工具调用自动完成浏览器操作。`AgentOptions` SHALL 支持可选的 trace 配置，用于控制操作过程日志的生成。`ActOptions` 不暴露 trace 相关配置。

#### Scenario: Login and navigate

- **WHEN** 用户调用 `await agent.act('登录系统', { variables: { username: 'admin', password: '***' } })`
- **THEN** Agent SHALL 自动调用 navigate/fill/press/click 等工具完成登录流程
- **AND** 操作完成后返回，不抛异常

#### Scenario: Action with trace enabled at Agent level

- **WHEN** 用户创建 Agent 时传入 `trace: { outputDir: './traces' }`
- **AND** 调用 `await agent.act('登录系统')`
- **THEN** Agent SHALL 在执行过程中采集 LLM reasoning、工具调用和截图
- **AND** 执行完成后 SHALL 在 `./traces/001-登录系统-143205/` 目录下生成 `trace.json`、`log.txt` 和 `screenshots/`

#### Scenario: Action with variables

- **WHEN** 用户传入 `variables: { keyword: '手机' }`
- **THEN** Agent SHALL 在指令中将 `${keyword}` 替换为实际值后执行
