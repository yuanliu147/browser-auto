## 新增需求

### 需求：系统提供统一的动作原语

系统 SHALL 暴露单一的 `actions/` 层，封装 Agent 可以执行的所有浏览器操作。LLM 工具和 memory replayer 都 SHALL 消费这些原语。

#### 场景：通过统一层执行点击

- **WHEN** 系统需要点击一个元素
- **THEN** `actions/` 层 SHALL 接受 CSS selector 或 `ElementLocator`
- **AND** SHALL 将其解析为 `backendNodeId`
- **AND** SHALL 通过 CDP 分发点击
- **AND** SHALL 返回结构化结果 `{ ok: true }`

#### 场景：通过统一层执行填充

- **WHEN** 系统需要填充输入框
- **THEN** `actions/` 层 SHALL 接受 value 字符串以及 CSS selector 或 `ElementLocator`
- **AND** SHALL 将目标解析为 `backendNodeId`
- **AND** SHALL 通过 CDP 分发填充
- **AND** SHALL 返回结构化结果 `{ ok: true }`

#### 场景：通过统一层执行导航

- **WHEN** 系统需要导航到某个 URL
- **THEN** `actions/` 层 SHALL 接受 URL 字符串
- **AND** SHALL 通过 CDP 分发 `Page.navigate`
- **AND** SHALL 返回实际加载的 URL

#### 场景：通过统一层执行等待

- **WHEN** 系统需要等待
- **THEN** `actions/` 层 SHALL 支持等待 selector 出现在 DOM 中
- **AND** SHALL 支持等待固定的毫秒数
- **AND** SHALL 在等待 selector 超时时抛出异常

#### 场景：通过统一层管理标签页

- **WHEN** 系统需要管理标签页
- **THEN** `actions/` 层 SHALL 支持列出所有页面标签页
- **AND** SHALL 支持按索引切换到某个标签页
- **AND** SHALL 支持创建带有可选 URL 的新标签页

### 需求：统一动作消除重复代码

系统 SHALL 不在 `tools/` 和 `memory/replayer.ts` 中为相同的浏览器动作维护独立的执行路径。

#### 场景：工具委托给 actions 层

- **WHEN** LLM 工具执行点击
- **THEN** 工具 SHALL 将目标解析和 CDP 分发委托给 `actions/`
- **AND** SHALL 不包含内联的 `resolveTarget` 或 `clickByBackendNodeId` 逻辑

#### 场景：Replayer 委托给 actions 层

- **WHEN** memory replayer 执行某一步
- **THEN** replayer SHALL 委托给工具使用的相同 `actions/` 原语
- **AND** SHALL 不包含内联的 `resolveReplayTarget` 或 `executeToolOnPage` 逻辑

### 需求：统一动作保持现有行为

`actions/` 层 SHALL 产生与当前分散实现完全相同的可观察结果。

#### 场景：带 selector 回退的点击

- **WHEN** 动作同时获得 `ElementLocator` 和 CSS selector
- **THEN** 系统 SHALL 先尝试定位器解析
- **AND** SHALL 在定位器解析失败时回退到 selector
- **AND** SHALL 在两者都失败时抛出异常

#### 场景：导航返回实际 URL

- **WHEN** navigate 动作完成
- **THEN** 系统 SHALL 返回导航后的 URL
- **AND** SHALL 与 `tools/navigate.ts` 的当前行为一致
