## 修改的需求

### 需求：系统可以按检查点 replay memory 路径

系统 SHALL 支持逐步骤 replay memory 路径，并在单步失败时保留已成功的检查点。

#### 场景：完整 replay 成功

- **WHEN** memory 路径的每一步执行均成功
- **THEN** 系统 SHALL 使用 `actions/` 层的统一原语执行每一步
- **AND** SHALL 标记任务完成
- **AND** SHALL 不调用 LLM

#### 场景：部分 replay 失败并交接

- **WHEN** memory 路径 replay 到第 3 步时定位失效
- **AND** 前 2 步已执行成功
- **THEN** 系统 SHALL 保留前 2 步的检查点
- **AND** SHALL 基于当前页面状态构造消息
- **AND** SHALL 让 LLM 从第 3 步开始接管
- **AND** LLM 接管后成功完成的剩余步骤 SHALL 被执行

### 需求：系统在 replay 时支持定位器回退

系统 SHALL 在 replay 时，当首选定位策略失效，尝试备用策略定位元素。

#### 场景：语义提示回退成功

- **WHEN** replay 某步时首选 label text `用户名` 未找到匹配
- **AND** 该步骤预存了 aria-label `username-input`
- **THEN** 系统 SHALL 通过 `actions/` 层尝试 aria-label 定位
- **AND** 命中时 SHALL 成功执行该步骤

#### 场景：结构位置回退

- **WHEN** label text 和 aria-label 均失效
- **AND** 该步骤记录了 structural hint `{tagName: "input", formIndex: 0, indexInForm: 2}`
- **THEN** 系统 SHALL 通过 `actions/` 层尝试结构位置定位
- **AND** 命中时 SHALL 成功执行该步骤

#### 场景：回退成功时的 memory 自修复

- **WHEN** 备用策略成功执行某步骤
- **THEN** 系统 SHALL 将该成功策略更新到 memory 路径中
- **AND** 下次 replay 时 SHALL 优先使用更新后的策略
