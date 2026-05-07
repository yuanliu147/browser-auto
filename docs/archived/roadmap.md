# browser-auto Roadmap

> 浏览器自动化底层引擎的版本规划。每个版本独立可发布,后版本基于前版本扩展,不删特性。

---

## 设计原则

1. **每版只解决一类问题**,主题清晰,避免大杂烩
2. **接口先于实现** —— v0.1 把所有未来要做的扩展点 interface 焊好,后续版本只填空
3. **每版独立可用** —— 不发布"半成品",每版有明确退出标准
4. **范围严控** —— 写明"不做"清单,防止范围蔓延
5. **底层稳,上层快** —— v0.1~v0.4 投入底层架构,v0.5+ 才开始堆上层产品力

---

## 版本时间线

| 版本     | 主题                | 估时(单人) | 关键交付                                        |
| -------- | ------------------- | ---------- | ----------------------------------------------- |
| **v0.1** | 核心 + 分层记忆     | 2~4 周     | act/extract/observe + L3+L2 记忆 + 7 个钩子接口 |
| **v0.2** | 健壮性              | 2 周       | 错误分类、重试、并发锁、覆盖率 90%              |
| **v0.3** | L1 区域记忆         | 2~3 周     | 子树裁剪,LLM token 压缩 50%+                    |
| **v0.4** | 动作策略            | 2 周       | 域名白名单 / 脱敏 / 审计 / Policy 配置          |
| **v0.5** | Daemon + 中后台适配 | 3~4 周     | `browser-auto daemon` CLI + AntDesign 适配      |
| **v0.6** | 工作流持久化        | 2~3 周     | YAML 工作流 + 条件循环 + CLI 导入导出           |
| **v1.0** | 可视化编排 + 回放   | 5~6 周     | Web UI + 拖拽编排 + 业务版剧本回放              |
| **v1.x** | 高级特性            | 持续       | DAG / 业务断言 / i18n / Python wrapper          |

**预估到 v1.0 全周期:5~7 个月**(纯估算,会随实际复杂度调整)。

---

## v0.1 — 核心执行 + 基础记忆

**主题**:能跑、能记。

**目标**:把"act/extract/observe + 分层记忆"作为 Stagehand 同级核心,且把所有未来扩展接口预留好。

**范围**:见 [v0.1-prompt.md](./v0.1-prompt.md)

**退出标准**:

- 5 个 example 全部跑通,验收清单 10 项全过
- act 第二次跑不调 LLM(L3 命中)
- extract 第二次跑不调 LLM(L2 命中)
- 7 个扩展钩子的 interface 在源码中可见

**不做**:见 v0.1-prompt.md 第 7 节。

---

## v0.2 — 健壮性

**主题**:不要在生产环境出洋相。

**目标**:v0.1 跑通了核心路径,v0.2 把所有"边缘情况"补齐。这一版不增加任何新能力,只让现有能力变靠谱。

**范围**:

1. **错误分类层** —— 把 Playwright 抛的 raw error 包装成结构化错误:
   - `BrowserAutoError` 基类
   - `SelectorNotFoundError` / `LLMError` / `MemoryCorruptError` / `PolicyAbortError` / `NetworkTimeoutError`
   - 每种带 `recoverable: boolean` 标识
2. **重试 / 退避策略** —— 节点级配置:
   - 默认指数退避 3 次
   - 用户可声明节点 `idempotent: false`,失败时强制人工确认
3. **并发控制** —— 同 page 的 act/extract/observe 串行执行(内置锁),避免乱序
4. **记忆条目回收** —— 失效条目按 LRU + 30 天 TTL 清理,memory.json 不无限膨胀
5. **测试覆盖率提升** —— 关键模块到 90%+,加 fuzzing 测试 fingerprint 稳定性

**退出标准**:

- 模拟"网络抖动"、"DOM 结构改了 30%"、"selector 全失效"三种场景,流程能正确报错或恢复
- memory.json 跑 1000 次 act 后体积可控(< 5MB)

**不做**:

- ❌ 业务级重试逻辑(那是用户的事)
- ❌ 分布式 / 多机协同

---

## v0.3 — L1 区域记忆 + 子树裁剪

**主题**:把 LLM token 成本压下来。

**目标**:大量中后台流程是"在固定区域内做小改动",每次都把全页快照喂给 LLM 太浪费。L1 让 LLM 只看相关子树。

**范围**:

1. **RegionMemory 实现** —— 落地 v0.1 预留的接口
2. **Snapshot 子树裁剪** —— SnapshotStrategy 已有 region 参数,planner 真正用上
3. **多 region 协作** —— 一个 act 可能涉及多个 region(如"在左边菜单点 A → 在右边表格找 B"),命中链按 region 拼装
4. **token usage 监控** —— TraceEvent.llm.response 加 `usage.promptTokens`,trace sink 聚合
5. **降级链完整化** —— L3 → L2 → L1 → L0 全链路通

**关键指标**:

- 在一个 5000+ DOM 节点的中后台页面上,相同任务的 LLM token 消耗 v0.3 比 v0.1 下降 ≥ 50%
- L1 命中率(在跑过两次的相同流程上)≥ 70%

**退出标准**:

- 跑一个标准压测脚本(20 个 act + 10 个 extract),token 消耗对比 v0.1 显著下降
- L1 接口被 act 和 extract 都使用

**不做**:

- ❌ region 嵌套 region(留 v1.x)
- ❌ region 自动发现算法,v0.3 由 LLM 在首次执行时记录

---

## v0.4 — 动作策略 (Action Policies)

**主题**:让 browser-auto 在合规场景能用。

**目标**:落地 v0.1 的 `BeforeActionInterceptor` / `AfterActionInterceptor` 接口,提供四类内置策略 + 配置文件。

**范围**:

1. **DomainAllowlistPolicy** —— 只允许访问白名单域名,Playwright 的 `page.route` 实现
2. **ActionFilterPolicy** —— 禁用 download / popup / file://、外链跳转
3. **DataMaskingPolicy** —— 截图前对登记的 selector 加遮罩;trace 数据中身份证 / 手机号自动脱敏
4. **AuditLogPolicy** —— 结构化审计日志(JSONL),记录"谁、何时、对什么页面、做了什么、结果"
5. **Policy 配置文件** —— `policies.yaml`,声明式配置:
   ```yaml
   policies:
     - type: domain-allowlist
       allowed: ["*.company.internal", "github.com"]
     - type: action-filter
       deny: ["download", "popup"]
     - type: audit-log
       output: ./.browser-auto/audit.jsonl
   ```

**退出标准**:

- 跑一个测试脚本,尝试访问黑名单域名 → 被拦截 + 错误清晰
- 审计日志可被任意 JSON 工具解析,字段完整

**不做**:

- ❌ 策略可视化配置 UI
- ❌ 加密 / 凭证管理(留 v1.x)

---

## v0.5 — Daemon 模式 + 中后台组件适配

**主题**:中后台开发者直接能用。

**目标**:这是 browser-auto 第一次面向"实际用户场景"的版本。Daemon 解决冷启动 / 登录态问题,AntDesign 适配解决重复劳动。

**范围**:

### Part A:Daemon

1. **`browser-auto daemon` CLI** —— 启动长驻 Node 进程,内部跑一个 Playwright server
2. **IPC / HTTP API** —— CLI / 客户端通过 HTTP 调 daemon
3. **多 session 管理** —— 一个 daemon 持有多个浏览器 context,SSO 登录一次共享
4. **冷启动优化** —— 预启动模式,常驻 1 个空白页

### Part B:中后台适配

5. **AntDesignSnapshotStrategy** —— 抽取 .ant-table-row、.ant-form-item、.ant-btn、.ant-menu-item、.ant-modal 等
6. **链式 API** —— `page.antTable.row({name: '张三'}).action('编辑')`
7. **可选:ElementPlusSnapshotStrategy** —— 只做最常见的 5~6 个组件
8. **选择器健康账本可查询接口** —— `session.stats.selectorHealth()`

**退出标准**:

- daemon 模式下,从 CLI 调一次 act 端到端 < 200ms(不含网络/LLM)
- 在一个真实 Ant Design demo 上,链式 API 比裸 selector 编排短 50%+
- 切换到 daemon 不需要改 v0.4 写好的脚本(API 层兼容)

**不做**:

- ❌ Arco / TDesign(留社区贡献)
- ❌ 移动端组件库

---

## v0.6 — 工作流持久化

**主题**:把记忆变成可分享的剧本。

**目标**:v0.5 之前所有"流程"都活在代码里,v0.6 让流程可以**导出为文件**,**他人导入即可跑**。

**范围**:

1. **Workflow YAML 格式** —— 从 memory.json 自动生成可读 workflow:
   ```yaml
   name: 批量审批订单
   steps:
     - act: 点击菜单"订单管理"
     - act: 在搜索框填入 ${keyword}
     - if: $extract.totalCount > 0
       loop:
         each: $extract.orderList
         do:
           - act: 点击行的"审批"按钮
   variables:
     keyword: { type: string, required: true }
   secrets:
     username: { from: env.USERNAME }
   ```
2. **Workflow 解释器** —— 读 YAML 跑流程,支持线性 + if + loop
3. **变量与凭证占位** —— `${var}` 运行时注入,凭证不进 YAML
4. **CLI 导入导出** —— `browser-auto workflow export <name>` / `import <file>`
5. **共享性测试** —— A 导出的 workflow,B 在不同环境(不同登录)能跑通

**退出标准**:

- 跑一个真实流程录入 → 导出 YAML → 在另一台机器导入跑通
- YAML 格式可被 git diff 审阅(行级变更可读)

**不做**:

- ❌ DAG(并行分支)留 v1.x
- ❌ Workflow Marketplace 留 v1.0

---

## v1.0 — 可视化编排 + 业务版回放

**主题**:非技术人员能用。

**目标**:browser-auto 从"开发者工具"升级为"业务可用产品"。可视化是最大门槛 —— v1.0 跨过这个门槛。

**范围**:

1. **Web UI(浏览器内)** —— Vite + React,跑在 daemon 里,localhost:port 访问
2. **节点抽取 → 拖拽画布** —— 访问目标网站 → SnapshotStrategy 抽取节点 → 渲染到画布
3. **流程节点连线** —— 用户连线生成 workflow YAML
4. **TraceEvent 回放器** —— 业务版剧本:截图前后对比 + 关键状态时间线 + 失败点高亮
5. **选择器健康度面板** —— 来源 v0.5 的 ledger,标红降级率高的选择器
6. **Workflow Marketplace MVP** —— 社区分享(可选,延 v1.1)

**退出标准**:

- 一个完全不会写代码的运营人员,看 30 分钟教程后能编一个"批量审批 + 导出 CSV"的流程
- 流程跑失败时,用户能通过回放器自查到具体哪一步、什么原因

**不做**:

- ❌ 在 Web UI 里写代码(那就是又造一个 IDE 了)
- ❌ 多人协同编辑

---

## v1.x — 高级特性(持续)

**不分版本号,做完哪个发哪个**:

- **DAG 并行** —— 多个独立步骤并发执行
- **业务断言 DSL** —— 可视化"导出 CSV 后校验文件 > 1KB"这类断言
- **i18n 自动映射** —— 中英文按钮自动跨语言识别
- **Python / Go wrapper** —— 多语言客户端(基于 v0.5 daemon API)
- **凭证管理** —— 加密 vault + 系统钥匙串集成
- **录制模式(可选)** —— 在浏览器里点一遍自动生成 workflow(对应早期讨论中的"录制",但延后到 v1.x 验证需求)
- **MCP server** —— browser-auto 作为 MCP 服务被其他 LLM 客户端调用

---

## 不会做的事

为了保持项目焦点,以下事项 **永远不在** roadmap:

| 事项                                   | 原因                                |
| -------------------------------------- | ----------------------------------- |
| 移动端自动化(Appium 类)                | 焦点在 Web 中后台,不分散            |
| 视觉模型理解(纯像素)                   | a11y + DOM 已足够,且视觉模型贵且慢  |
| 完整测试框架替代(Playwright Test 同级) | 我们是浏览器自动化引擎,不是测试框架 |
| 分布式调度(K8s 部署)                   | 单机够用,有需求让用户用 K8s 包一层  |
| 自家云服务                             | 本地优先是核心定位,不做 SaaS        |

---

## 评估机制(决定下一版做什么)

每个版本结束后,做一次轻量评估:

1. **真实使用反馈** —— 用户报告了什么 issue,集中在哪一类?
2. **技术债盘点** —— 上一版有没有为赶时间留的债?
3. **目标对齐** —— 当前版本是否真在向"中后台合规自动化"主线推进?

如果三项都答得清楚,按本 roadmap 推进。如果有偏差,调整后续版本范围 —— **roadmap 不是合同,是参考**。

---

## 与上层产品的关系

**browser-auto 是底层引擎**,上层产品是"中后台编排器"(目前还没单独命名)。
两者关系:

- browser-auto 提供:执行能力 + 分层记忆 + 策略 + Daemon + 工作流持久化
- 中后台编排器(上层)使用:browser-auto 的 API + 自家产品形态(可能是 Electron 桌面、SaaS、IDE 插件)
- v0.1~v1.0 全部在 browser-auto 仓库,**v1.x 之后** 才考虑上层产品独立仓库

参考:[./中后台编排器问题清单.md](./中后台编排器问题清单.md)(20 项问题清单,定义上层产品的能力边界)

---

## 文档目录约定

所有项目文档放在 `docs/`:

- `v0.1-prompt.md` —— v0.1 实施提示词(本期 Agent 接收)
- `roadmap.md` —— 本文件
- `中后台编排器问题清单.md` —— 上层产品 20 项能力清单(browser-auto 的目标场景定义)
- `architecture.md` —— v0.1 实施 Step 1 由 Agent 产出,代码架构图 + 数据流
- 后续每版的 release notes 命名 `release-v0.X.md`
