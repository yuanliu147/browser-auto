# browser-use AI 识别页面机制总结

基于对 `/Users/admin/WorkSpace/browser-use/browser_use/` 代码的分析，本文档总结 browser-use 如何让 AI Agent "看懂" 网页并与之交互。

---

## 一、核心数据采集：`_get_all_trees`

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/service.py:385`

这是 DOM 采集的起点，通过 Chrome DevTools Protocol (CDP) **并行发起 5 类数据采集**：

| 数据源        | CDP 方法                                   | 用途                                                   |
| ------------- | ------------------------------------------ | ------------------------------------------------------ |
| DOM 快照      | `DOMSnapshot.captureSnapshot`              | 带计算样式、布局矩形、paint order 的完整 DOM           |
| DOM 树        | `DOM.getDocument(depth=-1, pierce=True)`   | 完整 DOM 结构，含 shadow DOM                           |
| 无障碍树      | `Accessibility.getFullAXTree`              | 所有 frame 的无障碍节点（role、name、state）           |
| 设备像素比    | `Page.getLayoutMetrics`                    | 截图坐标与 CSS 坐标的换算                              |
| JS 事件监听器 | `Runtime.evaluate` + `getEventListeners()` | 探测框架绑定的事件（Vue `@click`、React `onClick` 等） |

JS 事件监听器检测通过 DevTools 专有 API `getEventListeners(el)` 实现，元素超过 1 万时跳过（`dom/service.py:459`）。

### iframe 滚动位置采集

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/service.py:399-435`

在采集快照前，通过 JS 遍历所有同域 iframe，记录 `scrollTop/scrollLeft`，用于后续坐标转换。

### 超时与重试

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/service.py:567-614`

4 个 CDP 请求并行执行，10 秒超时；失败的任务取消后重试，再设 2 秒超时。任一请求失败则抛出 `TimeoutError`。

### iframe 数量限制

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/service.py:627-634`

如果 snapshot 中的 document 数量超过 `max_iframes`，截断只保留前 N 个，防止 iframe 爆炸。

---

## 二、增强 DOM 树构建：`get_dom_tree`

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/service.py:663`

将 5 份数据交叉融合成 `EnhancedDOMTreeNode`，核心字段包括：

- `snapshot_node`: 布局信息（bounds、visibility、paint order、cursor style、is_clickable）
- `ax_node`: 无障碍信息（role、name、properties: focusable/editable/checked/expanded）
- `attributes`: HTML 属性（含 shadow DOM、内联事件处理器）
- `has_js_click_listener`: 是否通过 `getEventListeners` 检测到点击事件
- `absolute_position`: 跨 iframe 绝对坐标（含 iframe offset 累加）
- `backend_node_id`: CDP 内部节点 ID，用于后续操作定位

### iframe 处理

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/service.py:983-1023`

- **同域 iframe**: 递归合并到主树中
- **跨域 iframe**: 通过 CDP 单独获取其 DOM，再合并坐标（累加 iframe offset）

### Shadow DOM 处理

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/serializer.py:447-457`

Shadow DOM 内容始终被包含，即使 shadow host 不可见。`children_and_shadow_roots` 遍历所有子节点和 shadow root。

---

## 三、序列化过滤：`DOMTreeSerializer`

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/serializer.py:100`

将增强 DOM 树转化为 LLM 可读的文本格式，经过 **5 步层层过滤**：

### Step 1: `_create_simplified_tree`

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/serializer.py:435`

按可见性剪枝：

- 跳过 `script`、`style`、`meta` 等无用标签
- 跳过 SVG 子元素
- 跳过带 `data-browser-use-exclude="true"` 的元素
- 保留可见、可滚动、有 shadow content 的节点
- 特殊处理：`opacity:0` 的 file input 强制保留（Bootstrap 等框架常用）

### Step 2: `PaintOrderRemover`

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/serializer.py:119-121`

基于 `paint_order` 移除被其他元素完全遮挡的节点。

### Step 3: `_optimize_tree`

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/serializer.py:542`

移除无意义的中间父节点，压缩树深度。

### Step 4: `_apply_bounding_box_filtering`

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/serializer.py:131-137`

如果一个小元素被另一个元素 99% 包含，则剔除它（避免重复交互点）。

### Step 5: `_assign_interactive_indices_and_mark_new_nodes`

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/serializer.py:139-143`

给可点击元素分配连续编号 `[1]`, `[2]`, `[3]`...，生成 `selector_map: {1: node, 2: node, ...}`。

---

## 四、可交互元素判断：`ClickableElementDetector`

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/clickable_elements.py:6`

多优先级启发式判断，按顺序匹配：

| 优先级 | 信号                    | 说明                                                               |
| ------ | ----------------------- | ------------------------------------------------------------------ |
| 1      | `has_js_click_listener` | 通过 `getEventListeners()` 检测到 click/mousedown/pointerdown      |
| 2      | 原生交互标签            | `button`, `input`, `select`, `textarea`, `a`, `details`, `summary` |
| 3      | ARIA 角色               | `role="button"`, `role="link"`, `role="combobox"` 等               |
| 4      | 无障碍属性              | `focusable`, `editable`, `checked`, `expanded`, `pressed`          |
| 5      | 内联事件                | `onclick`, `onmousedown`, `tabindex`                               |
| 6      | 搜索相关 class/id       | 含 `search`, `magnify`, `glass` 等关键词                           |
| 7      | 小图标元素              | 10~50px 且有 `aria-label`/`data-action` 等                         |
| 8      | `cursor: pointer`       | 最后的 fallback                                                    |

### 特殊处理

- **Label 包装器**: `label` 包裹 `input` 时（如 Ant Design radio/checkbox），label 也被标记为可交互（`clickable_elements.py:59-66`）
- **搜索图标**: 通过 class/id/data 属性中的搜索关键词检测（`clickable_elements.py:75-103`）
- **禁用元素**: `disabled` 或 `aria-disabled` 的元素会被排除

### cursor 样式判断的局限

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/clickable_elements.py:242-243`

当前只检查 `cursor == 'pointer'`，未覆盖 `grab`、`text`、`move`、`resize`、`zoom-in` 等其他暗示可交互的 cursor 值。虽然 `cursor` 数据已采集（`enhanced_snapshot.py:133`），但消费端只用到了 `pointer`。

---

## 五、复合控件处理

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/serializer.py:150`

为复合控件添加虚拟组件：

- `input[type="date"]` / `input[type="time"]` -> 添加日历/时钟图标组件
- `select` -> 添加下拉箭头组件
- `details` -> 添加展开/折叠指示器
- `audio` / `video` -> 添加播放控制组件

---

## 六、分页按钮检测

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/service.py:1098`

在 DOM 处理完成后，通过文本模式匹配自动识别分页控件：

- `next`/`>`/`>>`/`->` -> `next`
- `prev`/`<`/`<</`<-`->`prev`
- `first`/`|` -> `first`
- `last`/`>` -> `last`
- 纯数字 + `role=button/link` -> `page_number`

检测结果写入 `BrowserStateSummary.pagination_buttons`，供 Agent 直接使用。

---

## 七、视觉输入系统（多模态）

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/agent/prompts.py:389-483`

browser-use 支持将截图作为多模态输入传给 LLM：

- `use_vision`: 是否启用视觉输入
- `llm_screenshot_size`: 截图可缩放后再发送（默认用 `LANCZOS` 算法 resize）
- `vision_detail_level`: `'auto'` / `'low'` / `'high'`

**截图流程**:

1. `ScreenshotWatchdog` 在截图前显式 `remove_highlights()`（`browser/watchdogs/screenshot_watchdog.py:55-62`）
2. 通过 CDP `Page.captureScreenshot` 获取 base64
3. 如需视觉输入，resize 后作为 image content 加入 LLM message

---

## 八、元素高亮机制（非 Set-of-Mark）

### 交互时高亮

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/browser/session.py:2786`

`highlight_interaction_element(node)`：给被点击/输入的元素画**动画角标**（corner brackets），1 秒后自动消失。纯用户可视化，不影响 LLM。

### DOM 调试高亮

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/browser/session.py:3033`

`add_highlights(selector_map)`：给所有可交互元素添加**蓝色虚线边框** + `backend_node_id` 标签。默认关闭（`dom_highlight_elements=False`）。

**关键**：截图前会 `remove_highlights()`，确保 LLM 看到的截图是干净的。这和 **Set-of-Mark (SoM)** 完全不同——SoM 是在截图上标注编号供 LLM 直接读取，而 browser-use 的标注是给人看的调试工具。

### Python/PIL 截图标注（未启用）

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/browser/python_highlights.py`

这是一个完整的 Python/PIL 截图标注系统，可在截图上用不同颜色绘制边界框：

- `button` -> 红色
- `input` -> 青色
- `a` -> 绿色
- `select` -> 蓝色
- `textarea` -> 橙色
- 其他 -> 紫色

但经全局搜索确认，**当前没有任何代码导入或调用此模块**。它是"孤儿"代码，可能是遗留实现或未来功能。

---

## 九、坐标系统与转换

### 跨 iframe 绝对坐标

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/service.py:1050-1060`

每个 `EnhancedDOMTreeNode` 都有 `absolute_position`，累加了所有父 iframe 的 offset。这使得跨 iframe 的坐标定位准确。

### 设备像素比

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/service.py:537-548`

通过 `device_width / css_width` 计算 DPR，用于：

- 截图坐标与 CSS 坐标的转换
- Python highlights 的坐标缩放

---

## 十、元素历史回放与匹配

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/agent/service.py:3511-3628`

Agent 可以回放历史操作。当页面发生变化后，需要通过 **5 级降级匹配** 找到之前交互过的元素：

```
Level 1: EXACT    -> element_hash 完全匹配
Level 2: STABLE   -> stable_hash 匹配（过滤动态 class 后的哈希）
Level 3: XPATH    -> XPath 字符串匹配
Level 4: AX_NAME  -> 无障碍名称 + 标签名匹配
Level 5: ATTRIBUTE -> 唯一属性匹配（name, id, aria-label）
```

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/views.py:165-172`

`MatchLevel` 枚举定义了匹配严格度。`stable_hash` 过滤了如 `active`、`selected` 等动态状态类，确保页面状态变化后仍能定位。

---

## 十一、缓存机制

### DOM 序列化缓存

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/serializer.py:62-71`

`DOMTreeSerializer` 接收 `previous_cached_state`，可以对比新旧 selector_map 标记哪些元素是"新出现"的。

### BrowserState 缓存

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/browser/session.py:1523-1525`

`browser_session._cached_browser_state_summary` 缓存上一次的状态，避免不必要的重复 DOM 采集。

### DOM Watchdog 缓存清除

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/browser/watchdogs/default_action_watchdog.py:522-563`

在页面导航、点击、输入等操作后，显式调用 `invalidate_dom_cache()` 清除缓存，确保下一次读取的是最新状态。

---

## 十二、未讨论到的设计要点

### 1. 语义分组（`_semantic_groups`）

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/serializer.py:108`

`DOMTreeSerializer` 内部维护了 `_semantic_groups`，但当前代码中未找到实际使用位置，可能为预留扩展。

### 2. 可交互元素的传播属性

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/serializer/serializer.py:44-56`

`PROPAGATING_ELEMENTS` 定义了哪些父元素需要把交互性传播给子元素（如 `<a>` 包裹的图片，`<div role="button">` 等）。

### 3. 元素文本提取策略

**位置**: `/Users/admin/WorkSpace/browser-use/browser_use/dom/views.py:568-571`

`get_all_children_text()` 在收集文本时会跳过已高亮的子元素，避免文本重复。

### 4. 滚动容器检测

`is_actually_scrollable` 标记实际可滚动的容器，这类元素即使没有点击事件也会被保留在简化树中。

---

## 架构图

```
+-------------------------------------------------------------+
|  _get_all_trees (CDP 并行采集)                               |
|  +-- DOMSnapshot.captureSnapshot                             |
|  +-- DOM.getDocument (pierce=true)                          |
|  +-- Accessibility.getFullAXTree (所有 frame)                |
|  +-- Page.getLayoutMetrics (DPR)                             |
|  +-- Runtime.evaluate + getEventListeners() (JS 事件)        |
+--------------------------+----------------------------------+
                           |
                           v
+-------------------------------------------------------------+
|  get_dom_tree (数据融合 -> EnhancedDOMTreeNode)               |
|  +-- 合并 snapshot + DOM + AX 数据                           |
|  +-- 递归处理 iframe (同域合并 / 跨域单独获取)                |
|  +-- 计算 absolute_position (累加 iframe offset)             |
+--------------------------+----------------------------------+
                           |
                           v
+-------------------------------------------------------------+
|  DOMTreeSerializer (5 步过滤 + 编号)                         |
|  1. _create_simplified_tree   (可见性剪枝)                   |
|  2. PaintOrderRemover         (遮挡剔除)                     |
|  3. _optimize_tree            (压缩树)                       |
|  4. _apply_bounding_box_filtering (包含过滤)                 |
|  5. _assign_interactive_indices   (编号 [1] [2]...)          |
+--------------------------+----------------------------------+
                           |
                           v
+-------------------------------------------------------------+
|  SerializedDOMState                                          |
|  +-- _root: 简化后的 DOM 树文本表示                           |
|  +-- selector_map: {index -> EnhancedDOMTreeNode}             |
|  +-- pagination_buttons: 分页按钮列表                         |
+-------------------------------------------------------------+
```

---

## 关键文件映射

| 功能              | 文件                                           | 关键行    |
| ----------------- | ---------------------------------------------- | --------- |
| CDP 并行数据采集  | `dom/service.py`                               | 385-660   |
| JS 事件监听器检测 | `dom/service.py`                               | 444-535   |
| iframe 滚动位置   | `dom/service.py`                               | 399-435   |
| DOM 树构建        | `dom/service.py`                               | 663-1041  |
| 序列化器          | `dom/serializer/serializer.py`                 | 41-148    |
| 可交互元素检测    | `dom/serializer/clickable_elements.py`         | 6-246     |
| 复合控件处理      | `dom/serializer/serializer.py`                 | 150       |
| 分页检测          | `dom/service.py`                               | 1098-1174 |
| 元素匹配/回放     | `agent/service.py`                             | 3511-3628 |
| 视觉输入/Prompt   | `agent/prompts.py`                             | 389-483   |
| 截图 Watchdog     | `browser/watchdogs/screenshot_watchdog.py`     | 45-84     |
| DOM Watchdog      | `browser/watchdogs/dom_watchdog.py`            | 352-490   |
| 交互高亮          | `browser/session.py`                           | 2786-3032 |
| DOM 调试高亮      | `browser/session.py`                           | 3033-3217 |
| Python PIL 标注   | `browser/python_highlights.py`                 | 1-548     |
| 坐标转换/DPR      | `dom/service.py`                               | 537-548   |
| 缓存管理          | `browser/watchdogs/default_action_watchdog.py` | 522-563   |
| 增强快照节点定义  | `dom/views.py`                                 | 323-340   |
| MatchLevel 枚举   | `dom/views.py`                                 | 165-172   |
