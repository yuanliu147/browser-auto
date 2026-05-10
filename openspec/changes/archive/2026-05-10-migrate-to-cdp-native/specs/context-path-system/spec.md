## ADDED Requirements

### Requirement: System can represent context path for nested contexts

系统 SHALL 支持用有序步骤数组表示从主页面到达目标元素的上下文路径，支持 iframe、shadow DOM、modal 的任意组合嵌套。

#### Scenario: Simple iframe context

- **WHEN** 目标元素在 iframe 内
- **THEN** 系统 SHALL 表示上下文路径为 `[{type: "frame", matcher: {urlPattern: "..."}}]`

#### Scenario: Nested iframe context

- **WHEN** 目标元素在 iframe 嵌套 iframe 内
- **THEN** 系统 SHALL 表示上下文路径为两个 frame 步骤的数组

#### Scenario: Shadow DOM context

- **WHEN** 目标元素在 shadow root 内
- **THEN** 系统 SHALL 表示上下文路径为 `[{type: "shadow", hostSelector: "#app"}]`

#### Scenario: Mixed iframe and shadow DOM

- **WHEN** 目标元素在 iframe 内的 shadow DOM 内
- **THEN** 系统 SHALL 表示上下文路径为 `[{type: "frame", ...}, {type: "shadow", ...}]`

### Requirement: System can enter context by path during replay

系统 SHALL 在 replay 记忆路径时，按 ContextPath 逐层进入目标上下文，再执行操作。

#### Scenario: Enter iframe context

- **WHEN** 某步操作的 contextPath 包含 frame 步骤
- **THEN** 系统 SHALL 获取当前 frame tree
- **AND** SHALL 按 matcher 规则找到匹配的 iframe
- **AND** SHALL 进入该 iframe 的 execution context
- **AND** SHALL 在其中执行该步操作

#### Scenario: Enter shadow DOM context

- **WHEN** 某步操作的 contextPath 包含 shadow 步骤
- **THEN** 系统 SHALL 在当前 context 中 querySelector 找到 shadow host
- **AND** SHALL 获取 host 的 shadow root
- **AND** SHALL 在 shadow root 中执行该步操作

#### Scenario: Nested context path replay

- **WHEN** 某步操作的 contextPath 包含 frame → shadow → frame 三层嵌套
- **THEN** 系统 SHALL 逐层进入每个上下文
- **AND** SHALL 在最终上下文中执行操作

### Requirement: System supports context path caching and recovery

系统 SHALL 在缓存操作路径时存储完整的 ContextPath，replay 失效时支持恢复。

#### Scenario: Cache path with context

- **WHEN** Agent 成功完成跨 iframe 的操作序列
- **THEN** 系统 SHALL 缓存的每步 SHALL 包含 `contextPath` 字段
- **AND** `contextPath` SHALL 包含进入目标上下文所需的全部步骤

#### Scenario: Recover when frame reloads

- **WHEN** replay 时某 iframe 已重新加载，缓存的 lastKnownId 失效
- **THEN** 系统 SHALL 使用 matcher 规则重新查找该 iframe
- **AND** SHALL 成功后更新缓存的 lastKnownId
- **AND** SHALL 继续 replay
