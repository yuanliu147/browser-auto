## ADDED Requirements

### Requirement: System can extract accessibility tree via CDP

系统 SHALL 通过 CDP `Accessibility.getFullAXTree` 获取页面的无障碍树，作为快照的语义基础。

#### Scenario: Extract AXTree from main frame

- **WHEN** 系统调用快照生成
- **THEN** 系统 SHALL 发送 `Accessibility.getFullAXTree`
- **AND** SHALL 返回包含 role、name、value、state、properties 的节点树

#### Scenario: Extract AXTree includes iframe content

- **WHEN** 页面包含 iframe
- **THEN** 系统 SHALL 获取所有 frame 的 AXTree
- **AND** SHALL 按 frameId 组织，保持层级关系

### Requirement: System can capture DOM snapshot via CDP

系统 SHALL 通过 CDP `DOMSnapshot.captureSnapshot` 获取包含布局、样式信息的结构化 DOM 快照。

#### Scenario: Capture full page snapshot

- **WHEN** 系统调用 DOMSnapshot 采集
- **THEN** 系统 SHALL 返回包含 `documents[]`、`layout[]`、`textBoxes[]` 的快照
- **AND** 每个元素 SHALL 包含坐标、大小、层级信息

### Requirement: System can infer component types via adapters

系统 SHALL 支持可插拔的组件类型 Adapter，将底层 DOM/ARIA 信息推断为用户可感知的组件类型。

#### Scenario: Default ARIA role without adapter

- **WHEN** 无 Adapter 匹配某节点
- **THEN** 系统 SHALL 返回该节点的标准 ARIA role（textbox、button、combobox 等）

#### Scenario: AntD Input recognized by adapter

- **WHEN** 某节点 class 包含 `ant-input` 且 role 为 textbox
- **AND** 已注册 `AntDAdapter`
- **THEN** 系统 SHALL 返回组件类型 `text-input`

#### Scenario: AntD Select recognized by adapter

- **WHEN** 某节点 class 包含 `ant-select`
- **AND** 已注册 `AntDAdapter`
- **THEN** 系统 SHALL 返回组件类型 `dropdown`

### Requirement: System can serialize snapshot to compact text for LLM

系统 SHALL 将内部结构化快照序列化为紧凑文本格式，供 LLM 理解页面结构。

#### Scenario: Serialize form page

- **WHEN** 快照包含一个表单页面
- **THEN** 系统 SHALL 输出类似 `[表单] 用户名 * [textbox, empty] / 邮箱 * [textbox, empty] / 提交 [button, primary]` 的紧凑文本
- **AND** SHALL 包含分组信息（如 `[弹窗] [表单]`）
- **AND** SHALL 标注组件类型而非底层 ARIA role

#### Scenario: Serialize long form with pagination hint

- **WHEN** 表单字段超过 20 个
- **THEN** 系统 SHALL 输出当前视口/焦点区域内的字段
- **AND** SHALL 标注 `... 还有 15 个字段在下方` 等分页提示
