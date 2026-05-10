# CDP 迁移 TODO（不删除）

> 记录从 Playwright 切换到原生 CDP 驱动过程中，暂不处理但需后续跟进的事项。
> 来源：2026-05-10 explore 会话（架构选型、快照格式、元素定位、上下文系统）。

---

## 一、P1 — 迁移完成后必须补齐（影响可用性）

### 1.1 自动等待机制

**现状**：Playwright 提供自动等待（元素 visible / stable / enabled 后才执行 action），切 CDP 后完全失去这层保护。

**风险**：CDP 直接执行 DOM 操作，目标元素可能尚未渲染或处于 loading 状态，导致操作失败。

**可能方案**：

- 工具层内建等待（click / fill 内部先 waitForVisible）
- CDP 事件驱动（监听 DOM.childNodeCountUpdated / Page.loadEventFired）
- LLM 显式调用 waitFor（当前已有简化版 waitFor 工具）

**暂不处理原因**：MVP 阶段先用简化 waitFor 兜底，稳定运行后再系统性地实现内建等待。

---

### 1.2 错误恢复策略

**现状**：当前 loop 只有简单的 try-catch 和 retry，没有对失败类型做分类。

**风险**：CDP 操作失败场景比 Playwright 更多（nodeId 失效、frame 导航、context 被销毁），没有分类恢复会导致大量无效重试。

**失败类型设计草稿**：

| 类型       | 示例                        | 恢复策略                        |
| ---------- | --------------------------- | ------------------------------- |
| 瞬态失败   | 元素还没出现                | 指数退避重试 3 次               |
| 结构性失败 | 元素被删了 / 页面刷新了     | 重新 snapshot → LLM 重新决策    |
| 定位失效   | backendNodeId / nodeId 过期 | fallback 到语义标识重新定位     |
| 业务失败   | 表单验证错误                | 将错误信息给 LLM，修正输入      |
| 致命失败   | Chrome 崩溃 / CDP 断连      | 重启浏览器 + 从 checkpoint 恢复 |

**暂不处理原因**：MVP 先跑通 happy path，错误恢复是第二阶段稳定性工作。

### 1.3 iframe / shadow DOM 完整支持

**现状**：

- Shadow DOM：`Accessibility.getFullAXTree` 天然可穿透 open shadow DOM，snapshot 能捕获其内容；但工具层（click/fill）未接入 `contextPath`，无法操作 shadow 内元素
- iframe：Accessibility Tree 不跨 frame，工具层也无法在 iframe 内执行 evaluate

**需补齐**：

1. `CDPPageManager` 增加 frame session 切换能力（`Target.attachToTarget` 获取 iframe 的 sessionId）
2. 工具参数增加 `contextPath`（click / fill / waitFor），让 LLM 可以指定操作目标所在的上下文
3. Snapshot 遍历所有 frame，分别获取 AXTree 后合并

**暂不处理原因**：当前 happy path（主 DOM 表单操作）已跑通，iframe/shadow 是中后台场景的边界 case，后续按需实现。

---

## 二、P2 — 功能增强（不影响核心流程）

### 2.1 流程编排层

**背景**：当前是单轮 `act()`，LLM 自由发挥，maxSteps 默认 50。中长流程（20+ 字段表单、向导式分步）面临上下文爆炸和无状态衔接问题。

**设计方向（已讨论）**：

- 人定义步骤骨架（顺序、字段映射、条件分支）
- 每步内部 LLM 自由执行
- 步骤间显式状态传递

**暂不处理原因**：底层 CDP 迁移优先，编排层是上层建筑，后做。

---

### 2.2 文件上传支持

**背景**：中后台表单常见文件上传（头像、附件、Excel 导入）。

**技术复杂度**：

- 原生 `<input type="file">` → 简单，CDP 的 `DOM.setFileInputFiles` 即可
- 自定义上传组件（拖拽区、裁剪预览）→ 复杂，需模拟拖拽事件或走文件选择对话框
- 大文件分片上传 → 需拦截网络请求验证

**暂不处理原因**：scope 外，后续按需实现原生 input 上传即可。

---

### 2.3 性能优化

**方向**：

- CDP 调用批量化（batch）：多个无关查询合并一次发送
- Snapshot 增量更新：只传变化部分，减少 LLM 上下文消耗
- Frame tree 缓存：避免每次操作都重新获取

**暂不处理原因**：MVP 阶段先保证功能正确，性能是后续调优项。

---

## 三、P3 — 长期事项（当前不阻塞）

### 3.1 可观测性

- ~~Trace 系统的 CDP 化改造~~（已完成：test-form-automation.ts trace 输出验证通过）
- 结构化日志（每个 tool call 的耗时、成功/失败、fallback 次数）
- 调试工具（操作失败时自动 screenshot + dump snapshot）

### 3.2 浏览器生命周期管理

- Chrome 崩溃后的自动恢复
- CDP WebSocket 断连后的重连机制
- 多标签页/窗口的协调策略

### 3.3 测试策略

- ~~CDP 迁移后的功能等价性验证~~（已完成：test-login.ts、test-form-automation.ts 均通过）
- ~~Benchmark 回归~~（已完成：bounding box 快 182x，frame eval 快 10x）
- 中后台表单场景的端到端测试用例（覆盖 iframe/shadow DOM 的完整场景）

---

## 四、已决策事项（供 TODO 参考）

以下是在本次 explore 中已确定的方向，后续实现时需遵循：

### ADR-001：浏览器驱动选型

- **决策**：CDP 原生，不用 Playwright
- **理由**：性能（bounding box 查询快 203x）、iframe 控制、DOMSnapshot 能力
- **代价**：失去自动等待和跨浏览器支持，需自建可靠性层

### ADR-002：元素缓存标识策略

- **决策**：语义标识为主（label-text > aria-label > structure > xpath）
- **理由**：中后台表单的 label 文本最稳定；backendNodeId 只适合单次会话；XPath 索引在列表场景极易失效

### ADR-003：组件类型识别

- **决策**：可插拔 Adapter 机制
- **理由**：核心层保持框架无关；AntD / Element / 自定义组件通过 Adapter 扩展

### ADR-004：上下文路径设计

- **决策**：ContextPath 混合策略（lastKnownId + matcher fallback）
- **理由**：兼顾 replay 速度和稳定性；支持 iframe / shadow DOM / modal 任意嵌套

### ADR-005：工具集精简

- **保留**：navigate, click, fill, getSnapshot, screenshot, submitDone, waitFor（简化）, tabs
- **删除**：press, hover, select, scroll, getText
- **暂不实现**：upload

---

## 五、相关文档

- `docs/playwright-vs-cdp-deep-dive.md` — 选型深度分析 + benchmark 数据
- `benchmark/` — 性能测试代码和结果
