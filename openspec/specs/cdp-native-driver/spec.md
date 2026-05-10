## ADDED Requirements

### Requirement: System can launch Chrome with remote debugging enabled

系统 SHALL 通过 `child_process.spawn` 启动 Chrome，开启远程调试端口，且不注入自动化检测标记。

#### Scenario: Launch Chrome on default port

- **WHEN** 系统需要启动浏览器
- **THEN** 系统 SHALL 查找系统 Chrome 可执行文件（跨平台）
- **AND** SHALL 使用 `spawn` 启动，参数包括 `--remote-debugging-port=9223`、`--user-data-dir`、`-no-first-run`、`--no-default-browser-check`
- **AND** SHALL 不传递 `--enable-automation`、`-enable-blink-features=AutomationControlled`、`--test-type`
- **AND** 进程 SHALL 以 `detached: true` 和 `stdio: "ignore"` 启动

#### Scenario: Launch Chrome with user-provided extra args

- **WHEN** 用户传入 `config.args`
- **THEN** 系统 SHALL 将用户参数追加到默认参数之后

### Requirement: System can connect to Chrome via CDP WebSocket

系统 SHALL 通过 CDP WebSocket 连接到已就绪的 Chrome 实例，并建立稳定的会话通道。

#### Scenario: Connect to freshly launched Chrome

- **WHEN** Chrome 已启动且调试端口就绪
- **THEN** 系统 SHALL 轮询 `http://localhost:9223/json/version` 确认 Chrome 就绪
- **AND** SHALL 通过 WebSocket 连接到 `ws://localhost:9223/devtools/browser/<id>`
- **AND** SHALL 返回 CDP Client，标记 `ownsBrowser = true`

#### Scenario: Connect to existing Chrome

- **WHEN** `localhost:9223` 已有 Chrome 运行
- **THEN** 系统 SHALL 直接连接复用
- **AND** SHALL 返回 CDP Client，标记 `ownsBrowser = false`

### Requirement: System can manage CDP session lifecycle

系统 SHALL 根据 Chrome 实例的来源决定是否在关闭时终止进程，并正确清理 CDP 会话。

#### Scenario: Close self-launched Chrome

- **WHEN** `ownsBrowser = true`
- **AND** 调用关闭方法
- **THEN** 系统 SHALL 发送 `Browser.close` CDP 命令终止 Chrome 进程

#### Scenario: Close reused Chrome

- **WHEN** `ownsBrowser = false`
- **AND** 调用关闭方法
- **THEN** 系统 SHALL 仅关闭 WebSocket 连接，不终止 Chrome 进程

### Requirement: System can get frame tree for context navigation

系统 SHALL 通过 CDP `Page.getFrameTree` 获取完整的 frame 树结构，用于 iframe 上下文定位。

#### Scenario: Get frame tree from main page

- **WHEN** 系统调用获取 frame tree
- **THEN** 系统 SHALL 返回包含主帧和所有子帧的树形结构
- **AND** 每个帧 SHALL 包含 `frameId`、`url`、`name` 和 `parentFrameId`

### Requirement: System can execute JavaScript in specific execution context

系统 SHALL 通过 CDP `Runtime.evaluate` 在指定的 execution context 中执行 JavaScript，支持主页面和 iframe。

#### Scenario: Execute in main frame

- **WHEN** 系统发送 `Runtime.evaluate` 不指定 `contextId`
- **THEN** 系统 SHALL 在主帧的默认 execution context 中执行

#### Scenario: Execute in iframe

- **WHEN** 系统指定 `contextId` 为某 iframe 的 execution context
- **THEN** 系统 SHALL 在该 iframe 中执行 JavaScript
