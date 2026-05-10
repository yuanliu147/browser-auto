## ADDED Requirements

### Requirement: System can locate element by label text

系统 SHALL 支持通过相邻 label 文本定位表单元素，作为首选定位策略。

#### Scenario: Locate by exact label text

- **WHEN** 页面存在 `<label>用户名</label>` 及其关联的 `<input>`
- **AND** 系统使用 label text `用户名` 定位
- **THEN** 系统 SHALL 返回该 input 元素的引用

#### Scenario: Locate by partial label text

- **WHEN** label 文本为 `请输入用户名`
- **AND** 系统使用 `用户名` 模糊匹配
- **THEN** 系统 SHALL 返回匹配度最高的元素

### Requirement: System can locate element by semantic attributes

系统 SHALL 支持通过 aria-label、placeholder、name 等语义属性定位元素。

#### Scenario: Locate by aria-label

- **WHEN** 元素有 `aria-label="搜索框"`
- **AND** 系统使用 aria-label `搜索框` 定位
- **THEN** 系统 SHALL 返回该元素

#### Scenario: Locate by placeholder

- **WHEN** input 有 `placeholder="请输入邮箱"`
- **AND** 系统使用 placeholder `请输入邮箱` 定位
- **THEN** 系统 SHALL 返回该 input

### Requirement: System can locate element by structural position

系统 SHALL 支持通过结构位置（tagName、formIndex、indexInForm）定位元素，作为语义属性失效时的 fallback。

#### Scenario: Locate by tag and form index

- **WHEN** 页面有多个 form
- **AND** 系统指定 `formIndex: 0, tagName: "input", indexInForm: 2`
- **THEN** 系统 SHALL 返回第 0 个 form 中的第 2 个 input

### Requirement: System supports multi-strategy fallback

系统 SHALL 支持按优先级链尝试多种定位策略，直到成功或全部失败。

#### Scenario: Label text fails, fallback to aria-label

- **WHEN** label text `用户名` 未找到匹配元素
- **AND** 该元素预存了 aria-label `username-input`
- **THEN** 系统 SHALL 尝试 aria-label 定位
- **AND** SHALL 成功后返回该元素

#### Scenario: All strategies fail

- **WHEN** label text、aria-label、placeholder、structural 全部失效
- **THEN** 系统 SHALL 抛出定位失败错误
- **AND** 错误信息 SHALL 包含尝试过的所有策略

### Requirement: System can cache element locator for replay

系统 SHALL 在记忆路径中存储元素的定位信息，支持跨会话复用。

#### Scenario: Cache locator with multiple strategies

- **WHEN** Agent 成功操作某元素
- **THEN** 系统 SHALL 缓存该元素的完整定位信息：
  - `labelText`、`ariaLabel`、`placeholder`、`tagName`、`formIndex`
- **AND** SHALL 不依赖 backendNodeId 作为持久标识
