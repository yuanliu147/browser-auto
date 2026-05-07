# Examples

## test-login.ts

一个最小可运行的浏览器自动化示例：在本地 HTML 表单上自动填写用户名/密码并点击登录。

### 浏览器启动策略

默认行为如下，不需要额外配置：

1. **优先连接本地 CDP** — 如果你已经用 `--remote-debugging-port=9222` 启动了 Chrome，会直接连上它，并创建一个隔离的匿名窗口（不污染你的日常标签）。
2. **Fallback 启动本地 Chrome** — 如果 CDP 连不上，自动启动你电脑上已有的 Chrome（macOS/Windows/Linux 都能自动找到），并指定一个**独立的临时用户目录**，保证不会污染你的日常浏览数据。
3. **最终 fallback 到 Playwright Chromium** — 如果本地 Chrome 也找不到，才会 fallback 到 Playwright 自带的 Chromium（需要 `pnpm exec playwright install chromium`）。

### 运行前准备

1. 复制环境变量模板：

   ```bash
   cp ../.env.example .env
   # 编辑 .env，填入 DEEPSEEK_API_KEY
   ```

2. 运行示例：
   ```bash
   npx tsx test-login.ts
   ```
