## MODIFIED Requirements

### Requirement: System can serialize snapshot to compact text for LLM

系统 SHALL 将内部结构化快照序列化为紧凑文本格式，供 LLM 理解页面结构。**交互元素 SHALL 携带稳定引用标识（ref ID）。**

#### Scenario: Serialize form page with refs

- **WHEN** 快照包含一个表单页面
- **THEN** 系统 SHALL 输出类似 `[@e1] [表单] 用户名 * [textbox, empty] / [@e2] 邮箱 * [textbox, empty] / [@e3] 提交 [button, primary]` 的紧凑文本
- **AND** 每个可交互元素 SHALL 标注 `@eN` 形式的 ref ID
- **AND** SHALL 包含分组信息（如 `[弹窗] [表单]`）
- **AND** SHALL 标注组件类型而非底层 ARIA role

#### Scenario: Serialize long form with pagination hint

- **WHEN** 表单字段超过 20 个
- **THEN** 系统 SHALL 输出当前视口/焦点区域内的字段
- **AND** SHALL 标注 `... 还有 15 个字段在下方` 等分页提示
- **AND** 可见字段 SHALL 携带 ref ID

### Requirement: System can infer component types via adapters

系统 SHALL 支持可插拔的组件类型 Adapter，将底层 DOM/ARIA 信息推断为用户可感知的组件类型。

#### Scenario: Default ARIA role without adapter

- **WHEN** 无 Adapter 匹配某节点
- **THEN** 系统 SHALL 返回该节点的标准 ARIA role（textbox、button、combobox 等）
- **AND** 若为交互元素 SHALL 分配 ref ID

#### Scenario: AntD Input recognized by adapter

- **WHEN** 某节点 class 包含 `ant-input` 且 role 为 textbox
- **AND** 已注册 `AntDAdapter`
- **THEN** 系统 SHALL 返回组件类型 `text-input`
- **AND** SHALL 分配 ref ID

## ADDED Requirements

### Requirement: System assigns stable ref IDs to interactive elements

系统 SHALL 在序列化过程中为所有交互元素分配递增的 ref ID，格式为 `@e1`、`@e2`...，并在输出文本中标注。

#### Scenario: Ref assignment for buttons and inputs

- **WHEN** 页面包含 button、link、textbox、checkbox 等交互元素
- **THEN** 系统 SHALL 为每个元素分配唯一 ref ID
- **AND** 输出文本 SHALL 包含 `[@eN]` 前缀

#### Scenario: Ref assignment excludes non-interactive elements

- **WHEN** 页面包含 heading、paragraph、static text 等非交互元素
- **THEN** 系统 SHALL 不分配 ref ID
- **AND** 这些元素 SHALL 仍以文本形式出现在输出中

### Requirement: System exposes refMap for tool consumption

系统 SHALL 在生成快照时维护 `refMap: Map<string, ElementLocator>`，将每个 ref ID 映射到该元素的完整定位信息。

#### Scenario: refMap contains multi-strategy locators

- **WHEN** 系统生成快照
- **THEN** 对 ref ID `@e1` 对应的元素
- **AND** `refMap.get("e1")` SHALL 返回包含 `textAnchor`、`semantic`、`structural`、`xpath` 中至少一种策略的 `ElementLocator`

#### Scenario: refMap is passed through ToolContext

- **WHEN** `getSnapshot` 工具执行完毕
- **THEN** `refMap` SHALL 通过 `ToolContext` 传递给后续工具调用
- **AND** `click` 或 `fill` 工具收到 `ref` 参数时 SHALL 能从 `context.refMap` 解析定位信息

### Requirement: System transparently passes through ignored nodes

系统 SHALL 在序列化时将被 `ignored` 标记的节点透明化处理，递归输出其子节点，而非直接丢弃整棵子树。

#### Scenario: Ignored wrapper with interactive children

- **WHEN** AX tree 中存在 `ignored=true`、`role=none` 的包装节点
- **AND** 该节点包含 button、textbox 等子节点
- **THEN** 系统 SHALL 跳过该包装节点本身
- **AND** SHALL 递归输出其所有子节点
- **AND** 子节点 SHALL 正常分配 ref ID

#### Scenario: Ignored leaf node

- **WHEN** 某节点 `ignored=true` 且无子节点
- **THEN** 系统 SHALL 直接跳过该节点
- **AND** 不输出任何内容
