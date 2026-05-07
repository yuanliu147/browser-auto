## 1. 项目准备

- [x] 1.1 将 `docs/v0.1/`、`docs/v0.2/`、`docs/v0.1-prompt.md`、`docs/roadmap.md` 归档到 `docs/archived/`，根目录保留 `docs/README.md` 说明当前方向
- [x] 1.2 安装 `packages/core` 依赖：`ai`、`@ai-sdk/openai`、`playwright`、`zod`
- [x] 1.3 确认 `tsconfig.json` 配置正确（ES2022、NodeNext）

## 2. 类型与基础架构

- [x] 2.1 创建 `src/types.ts`：定义 `AgentOptions`、`ActOptions`、`BrowserConfig`、`LLMConfig`
- [x] 2.2 创建 `src/browser/index.ts`：`createBrowserContext(opts)` —— 管理 Playwright Browser + Context 生命周期
- [x] 2.3 创建 `src/browser/page.ts`：`PageManager` —— 维护 currentPage，处理 new page / popup 事件自动切换
- [x] 2.4 创建 `src/llm/index.ts`：`createDeepSeekModel(config)` —— 返回 `deepseek(model ?? 'deepseek-v4-flash')`

## 3. 工具实现

- [x] 3.1 创建 `src/tools/index.ts`：`createBrowserTools(pageManager)` —— 组装 13 个工具
- [x] 3.2 实现 `navigate` 工具
- [x] 3.3 实现 `click` 工具（支持 selector fallback 到 text 匹配）
- [x] 3.4 实现 `fill` 工具
- [x] 3.5 实现 `press` 工具
- [x] 3.6 实现 `hover` 工具
- [x] 3.7 实现 `select` 工具
- [x] 3.8 实现 `waitFor` 工具
- [x] 3.9 实现 `screenshot` 工具（返回 base64）
- [x] 3.10 实现 `getSnapshot` 工具（返回精简 a11y tree）
- [x] 3.11 实现 `getText` 工具
- [x] 3.12 实现 `scroll` 工具
- [x] 3.13 实现 `tabs` 工具（list/switch/new）
- [x] 3.14 实现 `submitDone` 工具（标记任务完成）

## 4. Agent 核心

- [x] 4.1 创建 `src/agent.ts`：`BrowserAgent` 类
  - `act(instruction, opts?)` —— 调用 `generateText`（tools + system prompt for act）
  - `close()` —— 关闭 Browser/Context
- [x] 4.2 编写 act 的 system prompt
- [x] 4.3 处理变量替换：`${varName}` → 实际值

## 5. 公共 API

- [x] 5.1 创建 `src/index.ts`：导出 `createBrowserAgent`、`createBrowserTools`、公共类型

## 6. 验证

- [x] 6.1 写一个本地验证脚本 `scripts/test-login.ts`：打开一个本地 HTML 页面，执行 `agent.act('在用户名输入框填入 admin，密码输入框填入 123456，点击登录按钮')`
- [x] 6.2 运行 `pnpm build` 无类型错误
