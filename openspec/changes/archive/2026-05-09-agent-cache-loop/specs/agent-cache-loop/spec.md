# agent-cache-loop Specification

## Purpose

定义浏览器 Agent 的操作路径缓存与复用机制。系统通过从成功的执行轨迹中提取最小操作路径并缓存，使重复任务能够跳过 LLM 调用直接 replay，并在路径部分失效时支持断点续传式 fallback。

## ADDED Requirements

### Requirement: System can extract minimal path from successful trace

系统 SHALL 能够从成功的执行轨迹（trace）中提取最小操作路径，剔除探索性步骤。

#### Scenario: Extract from clean successful trace

- **WHEN** Agent 执行 `act('登录 GitHub')` 成功且 trace 中无任何失败步骤
- **THEN** 系统 SHALL 提取该 trace 中的执行性步骤（navigate, click, fill, press, hover, select, scroll, tabs, waitFor）
- **AND** SHALL 跳过探索性步骤（getSnapshot, screenshot, getText）
- **AND** SHALL 不提取 submitDone 作为缓存步骤
- **AND** 提取出的路径 SHALL 写入缓存

#### Scenario: Reject trace with failures

- **WHEN** Agent 执行某指令的 trace 中存在任何工具调用失败的步骤
- **THEN** 系统 SHALL 不提取该 trace 的最小路径
- **AND** SHALL 不将其写入缓存

#### Scenario: Reject incomplete trace

- **WHEN** Agent 执行的 trace 最后一步不包含成功的 submitDone
- **THEN** 系统 SHALL 不提取该 trace 的最小路径

### Requirement: System can cache and retrieve operation paths

系统 SHALL 支持按指令指纹索引缓存的操作路径，支持查询、写入和失效。

#### Scenario: Cache hit on exact instruction match

- **WHEN** 用户调用 `await agent.act('登录 GitHub')`
- **AND** 缓存中已存在该指令精确匹配的路径
- **THEN** 系统 SHALL 跳过 LLM 调用
- **AND** SHALL 直接 replay 缓存路径

#### Scenario: Cache miss

- **WHEN** 用户调用 `await agent.act('搜索某商品')`
- **AND** 缓存中不存在该指令的路径
- **THEN** 系统 SHALL 走正常 LLM 驱动流程
- **AND** 执行成功后 SHALL 自动提取路径写入缓存

#### Scenario: Cache invalidate on structural failure

- **WHEN** 缓存路径 replay 时发生结构性失效（页面 URL/标题完全不符合预期）
- **THEN** 系统 SHALL 从缓存中移除该路径
- **AND** SHALL 走 LLM 从头开始执行

### Requirement: System can replay cached path with checkpoints

系统 SHALL 支持逐步骤 replay 缓存路径，并在单步失败时保留已成功的检查点。

#### Scenario: Full replay success

- **WHEN** 缓存路径的每一步执行均成功
- **THEN** 系统 SHALL 标记任务完成
- **AND** SHALL 不调用 LLM

#### Scenario: Partial replay failure with handover

- **WHEN** 缓存路径 replay 到第 3 步时选择器失效
- **AND** 前 2 步已执行成功
- **THEN** 系统 SHALL 保留前 2 步的检查点
- **AND** SHALL 基于当前页面状态构造消息
- **AND** SHALL 让 LLM 从第 3 步开始接管
- **AND** LLM 接管后成功完成的剩余步骤 SHALL 被执行

### Requirement: System supports selector fallback during replay

系统 SHALL 在 replay 时，当首选选择器失效，尝试备用策略定位元素。

#### Scenario: Fallback selector succeeds

- **WHEN** replay 某步时首选选择器 `#login_field` 失效
- **AND** 该步骤预存了备用选择器 `input[name='login']`
- **THEN** 系统 SHALL 尝试备用选择器
- **AND** 备用选择器命中时 SHALL 成功执行该步骤

#### Scenario: Playwright built-in strategy fallback

- **WHEN** replay 某步时所有选择器均失效
- **AND** 该步骤记录了语义提示 `{ ariaLabel: 'Username' }`
- **THEN** 系统 SHALL 尝试 `page.getByLabel('Username')`
- **AND** 命中时 SHALL 成功执行该步骤

#### Scenario: Cache self-healing on fallback success

- **WHEN** 备用策略成功执行某步骤
- **THEN** 系统 SHALL 将该成功策略更新到缓存路径中
- **AND** 下次 replay 时 SHALL 优先使用更新后的策略
