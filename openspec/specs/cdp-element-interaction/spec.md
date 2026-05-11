## ADDED Requirements

### Requirement: System can click element via CDP Input domain

系统 SHALL 通过 CDP `Input.dispatchMouseEvent` 合成真实鼠标事件完成点击，而非依赖 JS `element.click()`。

#### Scenario: Click visible button

- **WHEN** 系统需要点击某元素
- **AND** 已通过 `DOM.resolveNode` 获取该元素的 `objectId`
- **THEN** 系统 SHALL 先调用 `DOM.scrollIntoViewIfNeeded({ objectId })`
- **AND** SHALL 调用 `DOM.getBoxModel({ objectId })` 获取元素几何信息
- **AND** SHALL 计算元素内容区域中心坐标 (cx, cy)
- **AND** SHALL 依次发送 `mouseMoved`、`mousePressed`、`mouseReleased` 事件到 (cx, cy)
- **AND** 事件完成后 SHALL 调用 `Runtime.releaseObject({ objectId })`

#### Scenario: Click element outside viewport

- **WHEN** 目标元素不在当前视口内
- **THEN** `DOM.scrollIntoViewIfNeeded` SHALL 自动滚动元素进入视口
- **AND** 后续点击 SHALL 成功执行

### Requirement: System can fill input via CDP Input domain

系统 SHALL 通过 `Runtime.callFunctionOn` 聚焦并清空输入框，再通过 `Input.insertText` 插入文本，而非直接设置 `element.value`。

#### Scenario: Fill text input

- **WHEN** 系统需要向某 input 填充文本
- **AND** 已通过 `DOM.resolveNode` 获取该元素的 `objectId`
- **THEN** 系统 SHALL 调用 `Runtime.callFunctionOn` 执行 `this.focus(); this.select(); this.value = '';`
- **AND** SHALL 触发 `input` 事件
- **AND** SHALL 调用 `Input.insertText({ text })`
- **AND** 完成后 SHALL 调用 `Runtime.releaseObject({ objectId })`

#### Scenario: Fill textarea

- **WHEN** 目标元素为 textarea
- **THEN** 系统 SHALL 使用与 input 相同的填充流程
- **AND** SHALL 正确插入多行文本

### Requirement: System can type text via CDP key events

系统 SHALL 支持通过 `Input.dispatchKeyEvent` 逐字符发送键盘事件，模拟真实打字行为。

#### Scenario: Type with Enter key

- **WHEN** 系统需要发送包含换行的文本
- **THEN** 系统 SHALL 对普通字符使用 `Input.insertText`
- **AND** 对 `\n` 字符 SHALL 发送 `keyDown` + `keyUp` 事件，key 为 `Enter`

### Requirement: System resolves backendNodeId to objectId before interaction

所有基于 CDP 的交互 SHALL 先将持久标识（backendNodeId）解析为运行时标识（objectId），操作完成后释放。

#### Scenario: Resolve and release objectId

- **WHEN** 系统持有某元素的 `backendNodeId`
- **THEN** 系统 SHALL 调用 `DOM.resolveNode({ backendNodeId })` 获取 `objectId`
- **AND** 交互完成后 SHALL 调用 `Runtime.releaseObject({ objectId })`
- **AND** 即使交互失败 SHALL 在 finally 块中释放
