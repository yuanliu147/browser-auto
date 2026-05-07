## Context

当前 `packages/core/src/browser/index.ts` 中的 `createBrowserContext` 使用 `chromium.launchPersistentContext` 启动 Chrome。Playwright 在该 API 内部会自动追加 `--enable-automation`、`--enable-blink-features=AutomationControlled`、`--test-type` 等参数，这些标记会被网站通过 `navigator.webdriver`、`window.chrome` 对象差异、启动参数读取等方式检测到。

用户需要避免这种检测，以便 Agent 在操作具有反自动化机制的网站时不被拦截。

## Goals / Non-Goals

**Goals:**

- 消除 Playwright 启动 Chrome 时注入的自动化检测标记
- 保留现有 `connectOverCDP` 复用逻辑（登录态、Cookie 不丢失）
- 支持 macOS、Linux、Windows 三平台的系统 Chrome 查找
- 保持 `BrowserHandles` 接口和 `ownsBrowser` 语义不变

**Non-Goals:**

- 深度指纹伪装（Canvas、WebGL、字体等）—— 不在本次范围
- 支持非 Chrome 浏览器（Edge、Firefox 等）
- 无头模式（headless）下的反检测 —— headless 本身就有大量检测面
- 行为模拟（鼠标轨迹、操作间隔随机化）

## Decisions

### 1. 外部启动而非修改 Playwright 参数

**选择**: 通过 `child_process.spawn` 直接启动系统 Chrome，而非试图抑制 Playwright 内部参数。

**理由**:

- Playwright 的 `launchPersistentContext` 是内部 API，参数注入逻辑随时可能变化，不可靠
- `spawn` 启动完全透明，我们控制每一个参数
- 社区已有 `undetected-playwright` 等方案，但引入额外依赖和维护成本

**替代方案**: 使用 `playwright-extra` + `puppeteer-extra-plugin-stealth` — 被否决，因为引入了整个 puppeteer 生态，且 stealth 插件维护不及时。

### 2. 平台路径查找采用硬编码 + 遍历模式

**选择**: 参考 Playwright 的 `_createChromiumChannel` 实现，按平台硬编码标准安装路径，逐个检查文件存在性。

**理由**:

- Chrome 在各平台的标准安装路径是稳定的
- 不需要调用系统命令（如 `which`、`where`），避免跨平台差异
- 简单可预测，无外部依赖

**macOS**: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
**Linux**: `/opt/google/chrome/chrome`, `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`
**Windows**: `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`, `%PROGRAMFILES%\Google\Chrome\Application\chrome.exe`, `%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe`

### 3. 端口等待采用轮询而非文件锁

**选择**: spawn 后通过 `fetch(http://localhost:port/json/version)` 轮询等待 CDP 就绪。

**理由**:

- Chrome 的 CDP 服务就绪没有事件通知机制
- 轮询简单可靠，超时可控（默认 15s）
- 同时可以验证响应中的 `Browser` 字段确认真的是 Chrome

### 4. `ownsBrowser` 语义保持不变

**选择**: 自己 spawn 的 Chrome，`ownsBrowser = true`；复用已有 CDP 连接的，`ownsBrowser = false`。

**理由**:

- 与现有 `closeBrowserContext` 逻辑完全兼容
- 用户通过 `config.browser` 传入的复用逻辑不受影响

## Risks / Trade-offs

| 风险                                                          | 缓解措施                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| Chrome 未安装或路径非标准                                     | 抛出清晰错误，提示用户安装 Chrome 或设置 `CHROME_PATH` 环境变量 |
| 端口被其他程序占用                                            | `waitForCDP` 验证响应中的 `Browser` 字段，非 Chrome 则报错      |
| Chrome 启动慢导致超时                                         | 可调超时参数；慢机器可延长                                      |
| Windows 路径查找遗漏                                          | 优先覆盖标准安装位置，用户可通过环境变量覆盖                    |
| 用户手动启动的 Chrome 和 Agent 启动的 Chrome 使用同一端口冲突 | 使用固定端口 `9223`，先尝试连接，已有则复用                     |

## Open Questions

- 是否需要支持通过环境变量或配置项覆盖 Chrome 路径？（当前计划支持 `CHROME_PATH`）
- 是否需要支持多实例并发（多个 Agent 各用不同 Chrome）？（当前暂不支持，固定端口 9223）
