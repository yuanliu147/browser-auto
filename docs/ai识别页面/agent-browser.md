# agent-browser AI 页面识别设计分析

> 分析仓库：`/Users/admin/WorkSpace/agent-browser`
> 核心目标：理解该仓库如何将浏览器页面转化为 AI（LLM）可理解、可交互的结构化表示

---

## 一、核心快照系统（Snapshot）

### 1.1 主入口

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:216-573`

```rust
pub async fn take_snapshot(
    client: &CdpClient,
    session_id: &str,
    options: &SnapshotOptions,
    ref_map: &mut RefMap,
    frame_id: Option<&str>,
    iframe_sessions: &HashMap<String, String>,
) -> Result<String, String>
```

### 1.2 执行流程

1. **启用 CDP 域**：`DOM.enable` + `Accessibility.enable`
2. **获取完整可访问性树**：`Accessibility.getFullAXTree` → 返回 `AXNode` 列表
3. **构建树结构**：`build_tree()` (`snapshot.rs:926-1058`) 将扁平 `AXNode` 转为父子树
4. **分配引用（Ref）**：给可交互/内容元素分配 `@e1`, `@e2` 等引用编号
5. **渲染为文本**：`render_tree()` (`snapshot.rs:1060-1188`) 输出缩进文本
6. **递归处理 iframe**：`resolve_iframe_frame_id()` (`snapshot.rs:576-607`) + 递归 `take_snapshot`

### 1.3 快照选项

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:77-84`

```rust
pub struct SnapshotOptions {
    pub selector: Option<String>,   // CSS 选择器限定范围
    pub interactive: bool,          // 仅显示可交互元素
    pub compact: bool,              // 紧凑模式（隐藏无 ref 的节点）
    pub depth: Option<usize>,       // 最大深度
    pub urls: bool,                 // 包含链接 URL
}
```

---

## 二、可交互元素获取逻辑（双轨检测）

系统使用**两套互补机制**识别可交互元素：

### 2.1 ARIA Role 主检测（语义层）

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:11-66`

```rust
// 可交互角色 → 自动分配 ref
const INTERACTIVE_ROLES: &[&str] = &[
    "button", "link", "textbox", "checkbox", "radio", "combobox",
    "listbox", "menuitem", "slider", "spinbutton", "switch", "tab", ...
];

// 内容角色 → 有非空 name 时才分配 ref
const CONTENT_ROLES: &[&str] = &[
    "heading", "cell", "article", "region", "main", "navigation", ...
];

// 结构角色 → 不分配 ref
const STRUCTURAL_ROLES: &[&str] = &[
    "generic", "group", "list", "table", "WebArea", "RootWebArea", ...
];
```

### 2.2 Cursor-Interactive 补充检测（行为层）

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:609-892`

函数 `find_cursor_interactive_elements()` 注入 JavaScript 扫描 DOM：

| 检测标准          | 方法                                               |
| ----------------- | -------------------------------------------------- |
| `cursor: pointer` | `getComputedStyle(el).cursor === 'pointer'`        |
| `onclick` 处理器  | `hasAttribute('onclick') \|\| el.onclick !== null` |
| `tabindex`        | `tabindex !== null && tabindex !== '-1'`           |
| `contenteditable` | `ce === '' \|\| ce === 'true'`                     |

**排除项**：

- 标准交互标签（`<a>`, `<button>`, `<input>` 等）—— 已由 ARIA 覆盖
- 继承父元素 `cursor:pointer` 的元素
- 隐藏/零尺寸元素

**分类标记**：`clickable` / `focusable` / `editable`

---

## 三、两路数据如何结合

**结合模型：以 AXTree 为骨架，以 cursor-interactive 为补充，通过 `backend_node_id` 关联**

### 3.1 数据流

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  路 A: Accessibility        │     │  路 B: DOM JS 扫描           │
│  .getFullAXTree()           │     │  find_cursor_interactive()   │
│  (role, name, backend_node_id)│    │  检测 cursor:pointer/onclick │
│                             │     │  /tabindex/contenteditable   │
└─────────────────────────────┘     └─────────────────────────────┘
              │                                   │
              └──────────┬────────────────────────┘
                         ▼
              HashMap<backend_node_id, CursorElementInfo>
```

### 3.2 结合点 1：角色提升（Promote）

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:899-924`

AXTree 中 `LabelText` / `generic` 节点包裹隐藏 radio/checkbox 时，cursor 扫描检测到后**提升角色**：

```rust
fn promote_hidden_inputs(tree_nodes: &mut [TreeNode], cursor_elements: &HashMap<i64, CursorElementInfo>) {
    for node in tree_nodes.iter_mut() {
        if !matches!(node.role.as_str(), "LabelText" | "generic") { continue; }
        if let Some(input_kind) = cursor_info.hidden_input_kind {
            node.role = input_kind.as_role().to_string();  // "LabelText" → "radio"
            if node.name.is_empty() { node.name = cursor_info.text.clone(); }
            node.checked = Some(cursor_info.hidden_input_checked.clone());
        }
    }
}
```

### 3.3 结合点 2：强制分配 Ref

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:354-370`

```rust
let mut should_ref = if INTERACTIVE_ROLES.contains(&role) {
    true
} else if CONTENT_ROLES.contains(&role) {
    !node.name.is_empty()
} else {
    false
};

// 如果该节点也是 cursor-interactive，强制 ref
if node.backend_node_id.is_some_and(|bid| cursor_elements.contains_key(&bid)) {
    should_ref = true;
}
```

### 3.4 结合点 3：渲染时附加 Cursor 信息

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:1167-1173`

```rust
if let Some(ref cursor_info) = node.cursor_info {
    line.push_str(&format!(" {} [{}]", cursor_info.kind, cursor_info.hints.join(", ")));
}
```

输出示例：

```
- generic "点击展开" [ref=e5] clickable [cursor:pointer, onclick]
```

### 3.5 结合点 4：名称回退

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:1109-1119`

AX name 为空时，在 interactive 模式下用 cursor 扫描到的 `textContent` 回退：

```rust
let unescaped_display_name = if !node.name.is_empty() {
    &node.name                               // 优先 ARIA name
} else if options.interactive {
    if let Some(ref ci) = node.cursor_info {
        &ci.text                             // 回退到 DOM textContent
    } else { &node.name }
} else { &node.name };
```

### 3.6 关键发现：没有"插入"逻辑，只有"补丁"逻辑

**agent-browser 目前并不会把 DOM 侧找到但 AXTree 中"不存在"的节点插入到树结构中**。结合方式是"在已有 AXTree 节点上打补丁（patch）"，而非"向树中插入新节点（insert）"。

#### 代码证据

整个 `take_snapshot()` 的流程如下：

```
1. build_tree(ax_tree.nodes)      ← 只从 AXTree 构建节点列表
2. find_cursor_interactive()      ← DOM 侧扫描，得到 cursor_elements
3. promote_hidden_inputs()        ← 修改已有节点的 role
4. 遍历 tree_nodes 分配 ref       ← 只遍历 AXTree 已有的节点
5. render_tree()                  ← 只渲染 AXTree 已有的节点
```

**没有任何步骤向 `tree_nodes` 添加新节点**。`cursor_elements` 只用于三种"修改"操作：

1. **`promote_hidden_inputs()`** — 修改已有节点的 `role`、`name`、`checked`
2. **强制 `should_ref = true`** — 给已有 `generic` 节点分配 ref
3. **附加 `cursor_info`** — 给已有节点添加 `clickable [cursor:pointer]` 标注

如果代码真要"插入漏掉的节点"，应该有反向遍历逻辑：

```rust
// 这段代码不存在：
for (bid, cursor_info) in cursor_elements.iter() {
    if !tree_nodes_has_backend_id(bid) {
        // 创建新 TreeNode 并插入到 tree_nodes
        // 还需要确定它在树中的父节点位置...
    }
}
```

#### 为什么这样设计

Chrome 的可访问性引擎通常**不会遗漏页面上可见的 DOM 元素**——它会为每个可见元素创建 AXNode，只是语义角色不够精确：

| AXTree 中的节点 | cursor-interactive 扫描发现      | 结合结果                                                          |
| --------------- | -------------------------------- | ----------------------------------------------------------------- |
| `generic ""`    | `cursor:pointer + onclick`       | `generic "点击展开" [ref=e5] clickable [cursor:pointer, onclick]` |
| `LabelText ""`  | 内部有隐藏 `input[type="radio"]` | `radio "选项A" [checked=false, ref=e3]`                           |

#### 边界情况

如果真有元素被 Chrome AX 引擎完全遗漏（如某些 shadow DOM 边界情况），该节点会被静默丢弃——DOM 侧检测到了，但无法在 AXTree 中关联，因此**不会分配 ref，也不会出现在输出中**。

---

## 四、树结构的重要性

**树结构对 AI 页面理解是"质量优化"而非"技术必需"**，核心用途：

| 用途                            | 代码位置                                   | 价值                                 |
| ------------------------------- | ------------------------------------------ | ------------------------------------ |
| **compact 模式保留祖先路径**    | `compact_tree()` (`snapshot.rs:1190-1227`) | 知道 `button "提交"` 在哪个表单里    |
| **范围限定（`-s` selector）**   | `effective_roots` (`snapshot.rs:310-336`)  | 确定 selector 匹配的顶层根节点       |
| **渲染缩进层次**                | `render_tree()` (`snapshot.rs:1060-1188`)  | LLM 更易定位和理解结构               |
| **跳过无 ref 节点但保留子节点** | `-i` 交互模式 (`snapshot.rs:1097-1103`)    | 只显示可交互元素，但保留其上下文层级 |

如果不需要 compact/selector/层级可读性，**纯扁平列表在技术上是可行的**。

---

## 五、跨 iframe 处理

### 5.1 同域 iframe（Same-Origin）

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/element.rs:306-320`

```rust
pub(super) fn resolve_ax_session(...) -> (serde_json::Value, &'a str) {
    if let Some(frame_id) = frame_id {
        if let Some(iframe_sid) = iframe_sessions.get(frame_id) {
            // 跨域：独立 session
            (serde_json::json!({}), iframe_sid.as_str())
        } else {
            // 同域：父 session + frameId 参数
            (serde_json::json!({ "frameId": frame_id }), session_id)
        }
    } else {
        (serde_json::json!({}), session_id)
    }
}
```

同域 iframe 的 `Accessibility.getFullAXTree` 支持 `frameId` 参数直接获取子 frame 的 AXTree。

### 5.2 跨域 iframe（Cross-Origin）

跨域 iframe 的 AXTree **无法通过父 session 获取**（浏览器安全隔离）。代码方案：

- Browser attach 阶段为每个跨域 iframe **单独创建 CDP session**
- 存储在 `iframe_sessions: HashMap<frame_id, session_id>`
- 调用时切换到独立 session，并在其上 `DOM.enable` / `Accessibility.enable`

### 5.3 初次 snapshot 即展开 iframe

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:494-557`

主 frame snapshot 完成后，遍历所有 `Iframe` 节点：

1. `resolve_iframe_frame_id()` 获取子 frame ID
2. 递归 `take_snapshot()` 获取子内容
3. 把子内容缩进插入到 Iframe 行后面

**限制**：

- 只展开一层（`if frame_id.is_none()`），嵌套 iframe 不处理
- 跨域 iframe 失败静默忽略（`if let Ok(...)` 过滤）

输出示例：

```
- Iframe [ref=e2]
  - WebArea
    - heading "Login Form"
    - textbox "Username" [ref=e3]
    - button "Sign In" [ref=e4]
```

---

## 六、Ref 引用系统与失效恢复

### 6.1 RefMap 结构

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/element.rs:8-122`

```rust
pub struct RefEntry {
    pub backend_node_id: Option<i64>,  // CDP 后端节点 ID
    pub role: String,
    pub name: String,
    pub nth: Option<usize>,            // 重复元素区分
    pub selector: Option<String>,
    pub frame_id: Option<String>,      // iframe 元素标记
}
```

### 6.2 失效恢复机制

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/element.rs:150-301`

`resolve_element_center()` 和 `resolve_element_object_id()` 采用两阶段策略：

1. **Fast path**：用缓存的 `backend_node_id` 调用 `DOM.getBoxModel` / `DOM.resolveNode`
2. **Stale fallback**：fast path 失败时，重新获取 AXTree，按 `role + name + nth` 匹配找到新的 `backendDOMNodeId`

```rust
// Fallback: re-query the accessibility tree to find a fresh node by role/name
let fresh_id = find_node_id_by_role_name(
    client, session_id, &entry.role, &entry.name,
    entry.nth, entry.frame_id.as_deref(), iframe_sessions
).await?;
```

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/element.rs:340-385`

`find_node_id_by_role_name()` 使用与 snapshot 相同的数据源（`Accessibility.getFullAXTree`），保证匹配一致性。

**为什么重要**：AI 执行操作后（如点击"加载更多"），DOM 可能重建，ref 失效。没有此机制，后续所有操作都会失败。

---

## 七、截图注释系统（Screenshot Annotation）

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/screenshot.rs`

为 multimodal LLM 建立**视觉元素 ↔ 文本引用**的映射桥梁。

| 函数                          | 行号 | 作用                                                                                                    |
| ----------------------------- | ---- | ------------------------------------------------------------------------------------------------------- |
| `take_screenshot()`           | 100  | 主入口：协调注释收集、覆盖层注入、截图、清理、投影                                                      |
| `collect_annotations()`       | 231  | 批量解析所有 ref 的 `backend_node_id` → CDP object ID → bounding rect，过滤零尺寸元素                   |
| `inject_annotation_overlay()` | 402  | 注入 DOM 覆盖层（`z-index: 2147483647`，`pointer-events: none`），在每个元素位置显示红色边框 + 编号标签 |
| `filter_annotations()`        | 377  | CSS selector 限定截图时，只保留与目标区域重叠的注释                                                     |
| `project_annotations()`       | 512  | 调整注释坐标（clip 截图或全页滚动的偏移）                                                               |
| `remove_annotation_overlay()` | 467  | 清理注入的覆盖层                                                                                        |

**为什么重要**：没有注释覆盖，multimodal LLM 看截图时无法将视觉元素与文本快照中的 `@e1` `@e2` 对应起来。

---

## 八、React 组件树内省

**文件**：

- `/Users/admin/WorkSpace/agent-browser/cli/src/native/react/tree.rs`
- `/Users/admin/WorkSpace/agent-browser/cli/src/native/react/scripts.rs`
- `/Users/admin/WorkSpace/agent-browser/cli/src/native/react/renders.rs`
- `/Users/admin/WorkSpace/agent-browser/cli/src/native/react/suspense.rs`
- `/Users/admin/WorkSpace/agent-browser/cli/src/native/react/vitals.rs`

### 8.1 React 组件树快照

- `TREE_SNAPSHOT` (`scripts.rs:13`)：拦截 React DevTools hook，将二进制 DevTools 协议解码为 JSON
- `format_tree()` (`tree.rs:17`)：输出组件层级，如 `0 1 - Root`

### 8.2 Fiber Render 性能分析

- `RENDERS_INIT` (`scripts.rs:161`)：在页面 JS 运行前注入，拦截 `hook.onCommitFiberRoot`，跟踪最多 200 个组件的渲染次数、挂载、重渲染、耗时、DOM 变更
- `RENDERS_STOP` (`scripts.rs:348`)：停止分析器，计算 FPS 统计
- `format_renders_report()` (`renders.rs:62`)：输出按总渲染时间排序的 markdown 表格

### 8.3 Suspense 边界分析

- `SUSPENSE_WALK` (`scripts.rs:430`)：遍历 React DevTools 操作，查找 Suspense 边界
- `BlockerKind` (`suspense.rs:57`)：将阻塞者分类为 `ClientHook` / `RequestApi` / `ServerFetch` / `Stream` / `Cache` / `Framework` / `Unknown`
- `analyze_boundaries()` (`suspense.rs:194`)：生成可操作洞察（主要阻塞者识别、根因分组、文件推荐）

### 8.4 Core Web Vitals + Hydration

- `VITALS_INIT` (`scripts.rs:628`)：安装 `PerformanceObserver` 监听 LCP、CLS、FCP、INP
- `VITALS_READ` (`scripts.rs:709`)：读取指标 + Navigation Timing TTFB
- `format_vitals_report()` (`vitals.rs:75`)：输出 Core Web Vitals 和 React hydration 分解

**为什么重要**：为 AI 提供 React 应用的深层语义理解——组件层级、渲染性能、Suspense 边界、hydration 瓶颈，远超 DOM 层面的信息。

---

## 九、Diff/比较系统

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/diff.rs`

两种 diff 引擎：

| 类型            | 函数                | 行号 | 说明                                                     |
| --------------- | ------------------- | ---- | -------------------------------------------------------- |
| 像素级图像 diff | `diff_screenshot()` | 21   | 逐像素计算欧氏颜色距离，生成红色高亮 diff 图             |
| 文本 diff       | `diff_snapshots()`  | 103  | 使用 `similar` crate 的 Myers 算法，快速路径处理相同输入 |

**为什么重要**：让 AI 能检测操作前后的页面状态变化——视觉上（截图 diff）和结构上（快照 diff）。

---

## 十、可访问性树增强与过滤

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs`

### 10.1 节点过滤与聚合

- **`build_tree()` (`snapshot.rs:926-1058`)**：
  - 跳过 `ignored` 节点和 `InlineTextBox` (938)
  - **StaticText 聚合** (978-1028)：连续的 `StaticText` 子节点合并到第一个，处理内联格式标签导致的文本拆分
  - 去重冗余 `StaticText`（父节点已有相同 name 时清空子节点）

- **`render_tree()` (`snapshot.rs:1060-1188`)**：
  - 跳过空 role 节点
  - 跳过无 ref 且子节点 ≤1 的 `generic` 节点 (1071)
  - 跳过移除不可见字符后为空的 `StaticText` (1072)
  - 跳过 `RootWebArea` / `WebArea` 包装器 (1089)
  - interactive 模式下跳过无 ref 节点 (1097)

### 10.2 不可见字符处理

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:68-75`

```rust
const INVISIBLE_CHARS: &[char] = &[
    '\u{FEFF}', '\u{200B}', '\u{200C}', '\u{200D}',
    '\u{2060}', '\u{00A0}',
];
```

在渲染时从 display name (1122) 和空 StaticText 检测 (1072) 中剥离这些字符，防止零宽字符干扰 LLM。

### 10.3 RoleNameTracker（树内去重）

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:185-214`

跟踪 `(role, name)` 对的出现次数，只为重复键分配 `nth` 索引。唯一键不分配 `nth`，保持 ref ID 简短可读。

---

## 十一、LLM 提示/模板系统

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/stream/chat.rs`

### 11.1 系统提示与工具定义

- `get_system_prompt()` (124)：从 `skills/` 目录加载 skill markdown，注入系统提示
- `CHAT_TOOLS` (156)：硬编码 OpenAI function-calling schema，定义 `agent_browser` 工具

### 11.2 截图富化

- `enrich_tool_output()` (335)：工具结果含截图路径时，读取图片 → 压缩为 JPEG（最大 1024px 宽，质量 40）→ base64 编码 → 内联为 data URL 返回给 LLM
- `compress_image_to_jpeg()` (287)：调整尺寸并重编码以减少 token 成本

### 11.3 消息压缩

```rust
const COMPACT_THRESHOLD_CHARS: usize = 200_000;
const KEEP_RECENT_MESSAGES: usize = 6;
```

- `estimate_chars()`：统计内容 + tool_calls 长度
- `find_safe_split()`：在 `user` 消息处找安全分割边界
- `summarize_for_compaction()`：调用 LLM 总结旧对话历史，保留 URL、操作、页面状态、错误、目标

### 11.4 安全命令白名单

`ALLOWED_COMMANDS` (369)：约 30 个安全命令的允许列表。

---

## 十二、元素可见性与视口过滤

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/element.rs:556-599`

```rust
pub async fn is_element_visible(...) -> Result<bool, String> {
    // 检查：rect.width > 0 && rect.height > 0
    // style.visibility !== 'hidden'
    // style.display !== 'none'
    // parseFloat(style.opacity) > 0
}
```

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:640-667`

cursor-interactive 扫描跳过：

- `el.closest('[hidden], [aria-hidden="true"]')`
- 零尺寸元素 (`rect.width === 0 || rect.height === 0`)

**注意**：**不跳过 `opacity:0` 或 `sr-only`** (671)，因为这些输入仍在 Chrome AX tree 中。

---

## 十三、SPA / 状态变化检测

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/browser.rs`

### 13.1 生命周期事件

- `WaitUntil` 枚举 (257)：`Load`, `DomContentLoaded`, `NetworkIdle`, `None`
- `navigate()` (652)：区分完整导航（新 `loader_id`）和同文档导航（hash 路由、`history.pushState`）
- `wait_for_lifecycle()` (699)：监听 `Page.loadEventFired` / `Page.domContentEventFired`

### 13.2 网络空闲检测

- `wait_for_network_idle()` / `poll_network_idle()` (734, 1494)：跟踪 `requestWillBeSent` vs `loadingFinished`/`loadingFailed`，要求 `Page.loadEventFired` 后 500ms 无待处理请求

### 13.3 SPA 导航脚本

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/react/scripts.rs:727`

`PUSHSTATE`：优先尝试 `window.next.router.push()` (Next.js)，回退到 `history.pushState()` + 合成 `popstate`/`navigate` 事件（兼容 React Router、TanStack Router、Vue Router）。

### 13.4 Web Vitals 检测

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/actions.rs:4855` + `react/scripts.rs:628-709`

`VITALS_INIT` 同时作为即时执行和 init script 安装，监听 LCP/CLS/FCP/INP，拦截 React profiling 的 `console.timeStamp`。

---

## 十四、Cursor-Interactive 去重逻辑

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:1312-1319`

```rust
fn build_dedup_set(ref_map: &RefMap) -> HashSet<String> {
    ref_map.entries_sorted()
        .into_iter()
        .filter(|(_, entry)| !entry.name.is_empty())
        .map(|(_, entry)| entry.name.to_lowercase())
        .collect()
}
```

- 用 `RefMap` 中已有 ref 的 ARIA 节点 name 作为去重依据
- cursor-interactive 元素如果在 ARIA tree 中已有同名记录，不额外附加 `clickable [cursor:pointer]` 标注
- 避免输出如 `link "Home" [ref=e1] clickable [cursor:pointer]` 的冗余信息

---

## 十五、Shadow DOM 处理（存在严重缺陷）

### 15.1 当前代码状态

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:1323-1341`

```rust
fn collect_backend_node_ids(node: &Value, ids: &mut HashSet<i64>) {
    if let Some(id) = node.get("backendNodeId").and_then(|v| v.as_i64()) {
        ids.insert(id);
    }
    // 标准 DOM 子节点
    if let Some(children) = node.get("children").and_then(|v| v.as_array()) {
        for child in children { collect_backend_node_ids(child, ids); }
    }
    // Shadow DOM
    if let Some(shadow) = node.get("shadowRoots").and_then(|v| v.as_array()) {
        for child in shadow { collect_backend_node_ids(child, ids); }
    }
    // iframe contentDocument
    if let Some(doc) = node.get("contentDocument") {
        collect_backend_node_ids(doc, ids);
    }
}
```

此函数**仅用于 selector 范围限定时收集 DOM 子树的 backendNodeId**，对 Shadow DOM 内部元素的**识别、交互、定位**没有任何帮助。

### 15.2 缺陷 1：cursor-interactive 扫描完全不遍历 Shadow DOM

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:636`

```javascript
var allElements = document.body.querySelectorAll("*");
```

`querySelectorAll('*')` **不会进入任何 Shadow Root**（open 或 closed 均不进入）。shadow 内部的交互元素（自定义按钮、输入框等）**完全被 cursor-interactive 扫描遗漏**。

### 15.3 缺陷 2：AXTree 中 Shadow Boundary 被抹平

Chrome 的 `Accessibility.getFullAXTree` 虽然会遍历 shadow 内部，但**shadow boundary 信息被抹平**——shadow 内部节点直接挂在 shadow host 下，不反映真实的 `ShadowRoot → 子节点` 结构。

这意味着 `find_node_id_by_role_name`（`element.rs:340`）按 role+name 匹配时，如果 shadow 内外存在同名元素，**可能匹配到错误节点**。

### 15.4 缺陷 3：CSS Selector 无法穿透 Shadow Boundary

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:236`

```rust
let js = format!("document.querySelector({})", ...);
```

`document.querySelector` 不能选中 shadow 内部的元素。`-s` selector 范围限定对 Web Components 无效。

### 15.5 缺陷 4：element.rs 中完全无 Shadow DOM 处理

在 `element.rs` 中搜索 `shadow`：**零结果**。`RefEntry` 没有 shadow host 字段，`resolve_element_object_id`、`resolve_element_center` 均未处理 shadow 上下文。

### 15.6 相关 Issue（仍为 OPEN）

| Issue                                                    | 状态     | 说明                                      |
| -------------------------------------------------------- | -------- | ----------------------------------------- |
| #1266 — Semantic locators do not work through shadow dom | **OPEN** | 语义定位器无法穿透 shadow                 |
| #333 — Shadow-dom objects in Salesforce screen           | **OPEN** | Salesforce（大量 Web Components）交互失败 |

---

## 十六、交互执行层

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/interaction.rs`

基于 Ref 执行操作，无需 CSS 选择器：

| 函数              | 行号 | 功能                 |
| ----------------- | ---- | -------------------- |
| `click()`         | 9    | 点击元素中心         |
| `dblclick()`      | 29   | 双击                 |
| `hover()`         | 48   | 悬停                 |
| `fill()`          | 83   | 清空并输入           |
| `type_text()`     | 150  | 输入文本（可选清空） |
| `select_option()` | 393  | 选择下拉选项         |
| `check()`         | 439  | 勾选复选框/单选框    |
| `uncheck()`       | 491  | 取消勾选             |

所有交互通过 `resolve_element_center()` 或 `resolve_element_object_id()` 解析元素。

---

## 十七、设计亮点总结

| 设计点          | 实现文件                          | 核心价值                                                                  |
| --------------- | --------------------------------- | ------------------------------------------------------------------------- |
| 双轨检测        | `snapshot.rs`                     | ARIA 语义 + 光标行为，覆盖标准组件和自定义交互元素                        |
| Ref 抽象        | `element.rs`                      | `@eN` 引用比 CSS 选择器更稳定、更紧凑                                     |
| 失效恢复        | `element.rs`                      | backend_node_id 失效时自动回退 role+name 匹配                             |
| iframe 穿透     | `snapshot.rs` + `element.rs`      | 自动展开 iframe 内容，支持跨域框架的独立 session                          |
| 隐藏输入提升    | `snapshot.rs`                     | `<label>` 包裹隐藏 `<input>` 时提升为正确角色                             |
| StaticText 聚合 | `snapshot.rs`                     | 合并内联标签导致的文本拆分，减少 token                                    |
| 截图注释        | `screenshot.rs`                   | 建立视觉 ↔ 文本引用的多模态映射                                           |
| React 内省      | `react/*.rs`                      | 超越 DOM 的组件级语义理解                                                 |
| Diff 系统       | `diff.rs`                         | 检测操作前后的视觉/结构变化                                               |
| 消息压缩        | `stream/chat.rs`                  | 控制上下文长度，避免超出 LLM 上下文窗口                                   |
| SPA 检测        | `browser.rs` + `react/scripts.rs` | 处理客户端路由和网络空闲状态                                              |
| Shadow DOM      | `snapshot.rs`                     | ⚠️ **存在严重缺陷**：cursor 扫描不遍历、selector 不穿透、ref 定位可能错误 |

---

## 十八、已知严重缺陷（非设计亮点）

### 18.1 视觉遮挡不处理

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/element.rs:556-599`

```rust
// is_element_visible 只检查元素自身样式：
rect.width > 0 && rect.height > 0 &&
style.visibility !== 'hidden' &&
style.display !== 'none' &&
parseFloat(style.opacity) > 0
```

**问题**：只检查元素自身是否可见，**不检查是否有其他元素（如弹窗遮罩层）盖在它上面**。

弹窗打开时，下层按钮仍然出现在 snapshot 中并分配 ref，AI 可能尝试点击一个被遮罩层盖住的元素，结果点击命中遮罩层。

**代码中的妥协**：

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/browser.rs:145`

```rust
"Another element is covering the target element. Try scrolling or closing overlays."
```

遮挡问题**只在执行阶段报错**，不在 snapshot 阶段过滤。

**相关 Issue**：

- #58（已关闭）— Misleading error message when element is blocked by overlay/cookie banner
- #1044（OPEN）— Clicking an invisible element seems to have no effect, yet command doesn't throw an error

### 18.2 React/Vue 合成事件检测不到

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/snapshot.rs:650`

```javascript
var hasOnClick = el.hasAttribute("onclick") || el.onclick !== null;
```

**问题**：React/Vue 的合成事件使用事件委托，**不会设置 DOM 元素的 `onclick` 属性**。上述检测对 React `onClick={() => {}}` 完全失效。

如果该元素也没有 `cursor:pointer` 或 `tabindex`，则**完全不会被识别为可交互元素**。

**相关 Issue**：

- #1011（OPEN）— React SPA button clicks don't trigger onClick handlers
- #160（OPEN）— some components do not have the "ref" tag

### 18.3 视口外元素仍可被点击

**问题**：snapshot 输出包含整个页面的元素，不区分是否在视口内。位于页面底部（需要滚动才能看到）的元素同样分配 ref。

AI 点击这些元素时，命令"成功"执行但无效果，因为鼠标事件发到了视口外的坐标。

**相关 Issue**：

- #1044（OPEN）— Clicking an invisible element seems to have no effect
- #1046（OPEN）— Is it possible to capture only the content currently visible in the viewport?

### 18.4 坐标点击可能 Miss Overlay

**文件**：`/Users/admin/WorkSpace/agent-browser/cli/src/native/interaction.rs:466-468`

```rust
// Verify the click changed the state (Playwright parity: _setChecked re-checks).
// If the coordinate-based click missed (e.g. hidden input, overlay), retry
// with a JS .click() on the element and its associated input.
```

代码注释**直接承认**坐标点击可能 miss（Material Design 的 ripple overlay、隐藏的 native input 等）。虽然加了 JS `.click()` 重试作为 fallback，但这说明坐标点击模型本身不可靠。

**相关测试**：

- `e2e_material_design_checkbox_radio`（`e2e_tests.rs:2856`）— 专门测试 hidden input + overlay 场景

---

## 十九、官方仓库 Issue 中的讨论与共识

### 19.1 对可访问树局限性的直接批评

**Issue #160** 中用户 Heelc 的反驳：

> "Relying **only on Playwright's accessibility tree is a good baseline, but it can be too limiting in practice** unless teams fully implement ARIA roles everywhere (which many projects unfortunately don't)."
>
> "A more robust approach might be combining:
>
> - Accessibility tree detection (semantic + ARIA)
> - Heuristics for 'interactive-looking' elements (click handlers, tabindex, contenteditable, pointer-events, cursor style, etc.)
> - Framework patterns / event listeners (e.g., React synthetic events)"

这是仓库里对可访问树**最直白的批评**。

### 19.2 交互模式过于严格的推动

**Issue #366**（已关闭）：

> "We have a set list of elements that we parse through to be marked as interactive, but a lot of web apps use shadow DOMs that might have custom tags and labels for interactive elements as well. **The check should also potentially look at calculated cursor values for a more liberal check**."

维护者的回应是直接加了 `-C / --cursor` 标志（后来成为默认行为），说明 `INTERACTIVE_ROLES` 白名单机制本身就被认为过于严格。

### 19.3 替代格式的探索

**Issue #60**（OPEN）：

> "I was working on a similar problem and needed a **token-efficient way for an LLM to read webpage content, not just navigate it** (what Playwright's built for). I started from Playwright's `ariaSnapshot` and tweaked it for content understanding (markdownifying text, flattening wrappers)."

核心观点：可访问树优化的是**导航**（找到并点击元素），不是**内容理解**。

### 19.4 社区提出的改进方向

| Issue | 提出的改进                                           |
| ----- | ---------------------------------------------------- |
| #160  | Accessibility Tree + Heuristics + Framework patterns |
| #1011 | JS-based click（`element.click()`）绕过坐标点击      |
| #1046 | 视口过滤（viewport-only snapshot）                   |
| #60   | 替代 snapshot 格式（markdownify、flatten wrappers）  |

---

## 二十、缺陷汇总表

| #   | 缺陷                      | 代码中发现 | Issue 讨论   | 严重程度 |
| --- | ------------------------- | ---------- | ------------ | -------- |
| 1   | 视觉遮挡不处理            | ✅         | #58, #1044   | 🔴 高    |
| 2   | React 合成事件检测不到    | ✅         | #1011, #160  | 🔴 高    |
| 3   | 视口外元素仍可点击        | ✅         | #1044, #1046 | 🔴 高    |
| 4   | Shadow DOM 穿透失败       | ✅         | #1266, #333  | 🟡 中    |
| 5   | Iframe 只展开一层         | ✅         | #318, #50    | 🟡 中    |
| 6   | 跨域 Iframe 静默忽略      | ✅         | #925         | 🟡 中    |
| 7   | 坐标点击 miss overlay     | ✅         | e2e 测试     | 🟡 中    |
| 8   | AXTree 被截断             | ❌         | #1187        | 🟡 中    |
| 9   | 表格单元格引用失败        | ❌         | #1286        | 🟡 中    |
| 10  | 自定义 ARIA combobox 失败 | ❌         | #1105        | 🟡 中    |
| 11  | Hidden checkbox 挂起      | ✅         | #335         | 🟡 中    |
| 12  | 空白字符处理错误          | ✅         | #1271        | 🟢 低    |
| 13  | 虚拟节点重复              | ❌         | #1338        | 🟡 中    |
| 14  | StaticText 链接检测不到   | ❌         | #1016        | 🟢 低    |

---

## 二十一、核心结论

agent-browser 以可访问树为骨架的设计在**标准 HTML 页面**上工作良好，但在以下场景存在系统性缺陷：

1. **现代前端框架**（React/Vue 合成事件、自定义组件、Portal）
2. **Web Components / Shadow DOM**
3. **弹窗/遮挡交互**（modal、overlay、backdrop）
4. **长页面/虚拟滚动**（视口外元素干扰 AI 决策）

社区共识（Issue #160）：

> **"Relying only on Playwright's accessibility tree is a good baseline, but it can be too limiting in practice."**
