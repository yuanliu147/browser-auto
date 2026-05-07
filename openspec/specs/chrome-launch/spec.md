## ADDED Requirements

### Requirement: System can find Chrome executable across platforms

系统 SHALL 支持在 macOS、Linux、Windows 平台上查找系统安装的 Chrome 可执行文件。

#### Scenario: Chrome found on macOS

- **WHEN** 系统在 macOS 上运行
- **THEN** 系统 SHALL 在 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` 查找 Chrome
- **AND** 文件存在时返回该路径

#### Scenario: Chrome found on Linux

- **WHEN** 系统在 Linux 上运行
- **THEN** 系统 SHALL 按顺序尝试以下路径：
  - `/opt/google/chrome/chrome`
  - `/usr/bin/google-chrome`
  - `/usr/bin/google-chrome-stable`
  - `/usr/bin/chromium`
  - `/usr/bin/chromium-browser`
- **AND** 返回第一个存在的路径

#### Scenario: Chrome found on Windows

- **WHEN** 系统在 Windows 上运行
- **THEN** 系统 SHALL 按顺序尝试以下路径：
  - `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`
  - `%PROGRAMFILES%\Google\Chrome\Application\chrome.exe`
  - `%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe`
- **AND** 返回第一个存在的路径

#### Scenario: Chrome path overridden by environment variable

- **WHEN** 环境变量 `CHROME_PATH` 已设置
- **THEN** 系统 SHALL 优先使用 `CHROME_PATH` 指定的路径
- **AND** 不执行平台默认查找

#### Scenario: Chrome not found

- **WHEN** 系统在所有标准路径均未找到 Chrome
- **AND** 环境变量 `CHROME_PATH` 未设置
- **THEN** 系统 SHALL 抛出错误，提示用户安装 Chrome 或设置 `CHROME_PATH`

### Requirement: System can launch Chrome without automation flags

系统 SHALL 能够通过外部进程启动 Chrome，且不注入任何自动化检测标记。

#### Scenario: Launch Chrome with clean arguments

- **WHEN** 系统需要启动 Chrome
- **THEN** 系统 SHALL 使用 `child_process.spawn` 启动 Chrome
- **AND** 传递以下参数：
  - `--user-data-dir=<profile-path>`
  - `--remote-debugging-port=9223`
  - `--no-first-run`
  - `--no-default-browser-check`
- **AND** 不得传递 `--enable-automation`、`-enable-blink-features=AutomationControlled`、`--test-type`
- **AND** 进程 SHALL 以 `detached: true` 和 `stdio: "ignore"` 启动

#### Scenario: Launch Chrome with user-provided extra args

- **WHEN** 用户传入 `config.args`
- **THEN** 系统 SHALL 将用户参数追加到默认参数之后

### Requirement: System can wait for Chrome CDP port to be ready

系统 SHALL 在连接 CDP 前确保 Chrome 的调试端口已就绪。

#### Scenario: Wait for CDP port

- **WHEN** 系统启动 Chrome 后
- **THEN** 系统 SHALL 轮询 `http://localhost:9223/json/version`
- **AND** 响应中 `Browser` 字段包含 `"Chrome"`
- **AND** 默认超时时间为 15000ms
- **AND** 超时后 SHALL 抛出错误

#### Scenario: Port occupied by non-Chrome service

- **WHEN** `localhost:9223` 被非 Chrome 服务占用
- **THEN** 系统 SHALL 检测到响应中 `Browser` 字段不包含 `"Chrome"`
- **AND** 抛出错误提示端口被非 Chrome 进程占用

### Requirement: System connects to Chrome via CDP

系统 SHALL 通过 CDP 连接到已就绪的 Chrome 实例。

#### Scenario: Connect to freshly launched Chrome

- **WHEN** Chrome 已启动且 CDP 端口就绪
- **THEN** 系统 SHALL 调用 `chromium.connectOverCDP("http://localhost:9223")`
- **AND** 返回的 `BrowserHandles` 中 `ownsBrowser = true`

#### Scenario: Reuse existing Chrome via CDP

- **WHEN** `localhost:9223` 已有 Chrome 运行
- **THEN** 系统 SHALL 直接 `connectOverCDP` 复用
- **AND** 返回的 `BrowserHandles` 中 `ownsBrowser = false`

### Requirement: System manages Chrome lifecycle correctly

系统 SHALL 根据 Chrome 实例的来源决定是否在关闭时终止进程。

#### Scenario: Close self-launched Chrome

- **WHEN** `ownsBrowser = true`
- **AND** 调用 `closeBrowserContext`
- **THEN** 系统 SHALL 调用 `browser.close()` 终止 Chrome 进程

#### Scenario: Close reused Chrome

- **WHEN** `ownsBrowser = false`
- **AND** 调用 `closeBrowserContext`
- **THEN** 系统 SHALL 不终止 Chrome 进程
- **AND** 如果 `ownsContext = true`，只关闭 Context
