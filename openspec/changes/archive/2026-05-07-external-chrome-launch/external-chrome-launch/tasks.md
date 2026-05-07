## 1. Chrome 路径查找模块

- [x] 1.1 创建 `packages/core/src/browser/chrome-path.ts`，实现 `getChromePath()` 函数
- [x] 1.2 实现 macOS 路径查找：`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- [x] 1.3 实现 Linux 路径查找：遍历 `/opt/google/chrome/chrome`、`/usr/bin/google-chrome` 等候选路径
- [x] 1.4 实现 Windows 路径查找：遍历 `%LOCALAPPDATA%`、`%PROGRAMFILES%`、`%PROGRAMFILES(X86)%` 前缀
- [x] 1.5 支持 `CHROME_PATH` 环境变量覆盖
- [x] 1.6 所有路径未找到时抛出清晰错误

## 2. Chrome 启动与 CDP 等待

- [x] 2.1 创建 `packages/core/src/browser/launcher.ts`，实现 `launchChrome(userDataDir, port)` 函数
- [x] 2.2 使用 `child_process.spawn` 启动 Chrome，参数包含 `--user-data-dir`、`--remote-debugging-port=9223`、`--no-first-run`、`--no-default-browser-check`
- [x] 2.3 确保不传递 `--enable-automation` 等自动化标记
- [x] 2.4 实现 `waitForCDP(port, timeout)` 函数，轮询 `http://localhost:9223/json/version`
- [x] 2.5 `waitForCDP` 验证响应中 `Browser` 字段包含 `"Chrome"`
- [x] 2.6 支持用户通过 `config.args` 传入额外参数并追加到默认参数后

## 3. 重写 Browser 连接逻辑

- [x] 3.1 修改 `packages/core/src/browser/index.ts` 中的 `createBrowserContext`
- [x] 3.2 保留 `connectOverCDP` 复用逻辑：先尝试连接已有 Chrome
- [x] 3.3 复用失败时，调用 `getChromePath()` → `launchChrome()` → `waitForCDP()` → `connectOverCDP()`
- [x] 3.4 自己启动的 Chrome，`ownsBrowser = true`；复用的 Chrome，`ownsBrowser = false`
- [x] 3.5 `closeBrowserContext` 逻辑更新：`ownsBrowser=true` 时通过保存的 `browserPid` 发送 SIGKILL 关闭 Chrome

## 4. 验证与清理

- [x] 4.1 编译通过：`pnpm run build`
- [x] 4.2 运行示例 `examples/test-login.ts`，确认浏览器无自动化提示栏
- [x] 4.3 在页面控制台执行 `navigator.webdriver`，确认返回 `false`（非 `true`）
- [x] 4.4 测试复用逻辑：第一次启动后，第二次运行确认复用同一 Chrome 实例；第一个持有者关闭时才杀掉 Chrome
- [x] 4.5 删除因改动而失效的导入/代码（`launchPersistentContext`、`chromium` 的 channel 相关、`killChrome` 未使用导入）
