## Context

当前系统使用 Playwright 作为浏览器驱动，通过 `playwright.chromium.launch()` 启动浏览器，利用 Playwright 的 Page/Frame/Locator 抽象进行 DOM 操作和元素定位。上层 Agent 通过 13 个工具与 Playwright 交互，记忆系统基于 CSS selector 提取和 replay 操作路径。

基于 benchmark 实测和 iframe/shadow DOM 场景分析，Playwright 的抽象层在以下场景成为瓶颈：

- 高频页面状态采集（bounding box 查询 CDP 快 203x）
- 嵌套 iframe 定位（Playwright 不暴露 frameId，无法构建全局唯一元素标识）
- shadow DOM 穿透（Playwright 的 locator 链在复杂嵌套下容易 stale）
- 现代中后台自定义组件识别（Playwright ariaSnapshot 将 AntD Select 识别为 generic）

因此需要将底层驱动全面迁移到原生 CDP，同时重构元素定位、快照生成和记忆系统以适配 CDP 的能力模型。

## Goals / Non-Goals

**Goals:**

- 用原生 CDP WebSocket 连接替代 Playwright 作为浏览器驱动
- 实现基于 CDP Accessibility Tree + DOMSnapshot 的页面快照系统
- 实现语义元素定位（label-text / aria-label / structure / xpath 多级回退）
- 实现上下文路径系统（ContextPath），支持 iframe / shadow DOM / modal 的嵌套与缓存 replay
- 重构工具集为最小可用集（8 个工具）
- 保持上层 Agent Loop、变量替换、Trace 采集等能力不变

**Non-Goals:**

- 流程编排层（半结构化工作流）—— 列为后续 TODO
- 文件上传支持 —— 暂不实现
- 自动等待机制的系统级实现 —— MVP 阶段用简化 waitFor 兜底
- 错误恢复策略的分类处理 —— 第二阶段补齐
- 跨浏览器支持（Firefox/WebKit）—— CDP 仅支持 Chromium

## Decisions

### Decision 1: CDP 原生驱动，不保留 Playwright 双轨

**选择**: 全面切换到 CDP，不保留 Playwright 作为可选驱动。

**理由**:

- 产品定位是 AI Agent 框架，不是测试框架，不需要跨浏览器兼容
- 双轨维护成本高，且两套驱动的工具实现、元素标识、快照格式完全不同
- Stagehand v3 的混合方案适合有存量测试基础设施的项目，我们从零开始无需兼容

**替代方案**: 混合方案（默认 CDP + Playwright fallback）—— 维护成本过高，否决。

### Decision 2: 元素标识以语义为主，不依赖 backendNodeId

**选择**: 缓存和定位使用语义标识（label-text > aria-label > structure > xpath），backendNodeId 仅作为单次会话内的临时操作句柄。

**理由**:

- backendNodeId 在 DOM 变化后全部失效，不适合跨会话复用
- 中后台表单的 label 文本由业务定义，稳定性远高于 DOM 结构
- XPath 的索引在列表增删场景极易失效
- 语义标识对人类可读，调试和排障更友好

**替代方案**: backendNodeId 主标识 + 刷新后重建 —— 重建成本高且不可靠，否决。

### Decision 3: ContextPath 使用 matcher 规则链，不用 frameId 链

**选择**: 缓存时存储上下文匹配规则链（url-pattern / host-selector / trigger-text），replay 时逐层匹配进入。

**理由**:

- frameId 在页面刷新后全部重新分配，不适合持久化
- 匹配规则（如 url 包含 `/user-form`）在页面重构后仍然稳定
- 逐层匹配的开销可接受（通常 1-3 层嵌套）

**优化**: 首次 replay 时缓存解析后的 frameId，后续同一会话内直接使用，减少重复匹配。

### Decision 4: 快照输出分层（内部 JSON + LLM 文本）

**选择**: 内部使用结构化 JSON 存储完整定位信息，给 LLM 的输入序列化为紧凑文本。

**理由**:

- JSON 便于工具层反查定位信息（backendNodeId、frameId、rect 等）
- 紧凑文本减少 LLM 上下文消耗，提高推理速度
- 两层格式通过统一 ID 关联，避免信息不同步

### Decision 5: 组件类型识别使用可插拔 Adapter

**选择**: 核心层只做标准 ARIA role 提取，AntD / Element / 自定义组件的识别通过 Adapter 插件实现。

**理由**:

- 核心层保持框架无关，不耦合任何 UI 库
- 中后台系统使用的组件库各异，硬编码维护成本高
- 业务方可自行编写 Adapter 适配内部组件

## Risks / Trade-offs

| Risk                                            | Mitigation                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| CDP 无自动等待，操作可能 target 未就绪          | MVP 阶段保留简化 waitFor 工具；工具层内部添加基础的存在性检查           |
| CDP 的 nodeId / backendNodeId 在 DOM 变化后失效 | 不将其作为缓存主标识；单次操作内使用，操作前重新 query                  |
| CDP 连接断开或 Chrome 崩溃                      | 暂不实现自动重连；崩溃时抛错，由调用方处理                              |
| 自定义组件 Adapter 覆盖不全                     | 默认降级到 ARIA role；社区可贡献 Adapter；内部组件自行编写              |
| 迁移期间功能回退                                | 保留现有 benchmark 用例，迁移后做功能等价性验证                         |
| 跨域 iframe 的 JS 执行受限                      | 利用 CDP 的 frame-scoped Runtime.evaluate，在同源策略允许范围内操作 DOM |

## Migration Plan

1. **Phase 1**: CDP 连接层 —— 启动 Chrome、建立 WebSocket、封装 CDP Client
2. **Phase 2**: 快照系统 —— 实现 Accessibility Tree 提取、组件 Adapter、LLM 文本序列化
3. **Phase 3**: 工具重写 —— click / fill / getSnapshot / screenshot 等工具改为 CDP 实现
4. **Phase 4**: 记忆系统适配 —— extractor / replayer 支持语义标识和 ContextPath

**Rollback**: 如迁移中出现阻塞问题，可回退到 Playwright 版本（保留 git 分支）。

## Open Questions

- 是否需要在 CDP 层面实现调用批量化（batch）以减少往返？—— 性能优化阶段再评估
- snapshot 的增量更新策略（只传变化部分）—— 第二迭代考虑
- 弹窗（modal）的检测是否依赖特定 class 模式，还是通过 Accessibility Tree 的 `isModal` 属性？—— 实现时验证 CDP Accessibility Tree 的弹窗识别能力
