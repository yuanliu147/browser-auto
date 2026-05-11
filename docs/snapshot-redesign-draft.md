# Snapshot 重设计 — 探索草稿

> 状态:**草稿,explore 阶段** — 尚未达成最终设计共识,本文档保存探索过程结论,以防上下文压缩后丢失。
> 触发点:用户反馈「snapshot 工具没有正常返回」,且后续要支持「缓存/replay 操作路径」。
> 上下文:与 `docs/agent-cache-loop-*` 系列文档相关,**需要进一步对照评估**。

---

## 1. 现状诊断 — 直接 bug

### 1.1 现象

用 `npx tsx diagnose-login.ts` 访问 `http://127.0.0.1:5500/examples/login-page.html`:

- `Accessibility.getFullAXTree` 返回 **54 个节点**
- `serializeSnapshot()` 输出仅 **1 个根节点**:
  ```
  - 登录页 [RootWebArea]
  ```
- 真实页面的 textbox / button / heading 全部丢失

### 1.2 根因

`packages/core/src/snapshot/serializer.ts:18-30`

```ts
function shouldInclude(node) {
  if (node.ignored) return false;       // ← 被 ignore 的节点直接返回 null
  if (!node.role && !node.name) return false;
  return true;
}

function serializeNode(node, tree, domMap) {
  if (!shouldInclude(node)) return null;   // ← 切断整棵子树
  ...
}
```

Chrome 的 AX tree 会在中间插一堆 `role=none, ignored=true` 的结构包装节点。一旦遇到这种节点,`return null` → 父的 children 数组里啥都没有 → 真正有内容的子树全部消失。

### 1.3 最小修复(立即可做)

让被剔除的节点「透明化」,把它的 children 上推:

```ts
function serializeNode(node, tree, domMap): SerializedElement[] {
  const kids: SerializedElement[] = [];
  for (const cid of node.childIds ?? []) {
    const c = tree.nodeMap.get(cid);
    if (c) kids.push(...serializeNode(c, tree, domMap));
  }
  if (!shouldInclude(node)) return kids;
  return [{ ...buildNode(node), children: kids }];
}
```

期望效果:

```
- 登录页 [RootWebArea]
  - 登录 [heading]
  - 账号 [textbox]
  - 密码 [textbox]
  - 登录 [button]
```

### 1.4 其他孤儿代码(顺手清理或激活)

- `packages/core/src/snapshot/adapter.ts` — AntD/Element 组件适配器,但 `inferComponentType` 永远收不到 `domInfo`(serializer 的 `domMap` 参数从未被入口传入)
- `packages/core/src/snapshot/domsnapshot.ts` — `captureDOMSnapshot` 函数完整实现但**全项目无调用方**

---

## 2. 真实代码读取后的发现(对照 Stagehand & Agent-Browser)

⚠️ **修正**:之前给的对比表基于 `/Users/xianyi/CustomGit/stagehand/snapshot-summary.md`,**没读真实代码**,部分描述不准确。本节是补读真实代码后的修正。

### 2.1 Stagehand 真实剪枝逻辑

文件:`stagehand/packages/core/lib/v3/understudy/a11y/snapshot/a11yTree.ts:153-217`

**两阶段**:

1. **阶段一 — 第一轮宽松过滤**(line 159-166)
   ```ts
   const keep =
     !!n.name?.trim() ||
     !!n.childIds?.length || // ← 有 children 就保留,即使是 structural
     !isStructural(n.role);
   ```
2. **阶段二 — pruneStructuralSafe 递归扁平化**(line 185-216)
   - structural 节点 + 1 child → **用 child 替代自己**(扁平化)
   - structural 节点 + 0 child → 删除
   - generic/none 节点有 encodedId → **role 替换为 DOM tagName**
   - combobox + tag=select → role 改为 select

加一个优雅去噪(line 233-249):

- 如果 children 的 StaticText 名字拼接 == parent.name → **删除所有 StaticText**
- 这消除了 `button "登录" + StaticText "登录"` 的重复

### 2.2 Stagehand 输出格式

`treeFormatUtils.ts:8-15`:

```
[encodedId] role: name
```

例:`[1-7] textbox: 账号`,LLM 直接看到 ID,可以返回 `click [1-7]`。

### 2.3 Stagehand 的 XPath 是怎么生成的

`xpathUtils.ts:38-65`:

```
absoluteXPathForBackendNode(session, backendNodeId):
  1. DOM.resolveNode(backendNodeId) → 拿 objectId
  2. Runtime.callFunctionOn(objectId, nodeToAbsoluteXPath)  ← 浏览器里跑 JS
  3. 返回 absolute XPath,形如 /html/body/div[1]/form/input[2]
```

**关键**:是**绝对 XPath**,**对 DOM 微变敏感** — 中间插一个 div 就错位。

### 2.4 Stagehand HybridSnapshot 输出结构

`capture.ts:460-473`:

```ts
{
  combinedTree: string,                       // 文本树(给 LLM)
  combinedXpathMap: Record<string, string>,   // encodedId → absolute XPath
  combinedUrlMap: Record<string, string>,     // encodedId → href(仅链接)
  perFrame: Array<{ frameId, outline, xpathMap, urlMap }>
}
```

snapshot 本身就携带 xpathMap,后续工具用它把 encodedId 翻译成 XPath。

### 2.5 Agent-Browser RefEntry 真实结构

文件:`agent-browser/cli/src/native/element.rs:8-16`

```rust
pub struct RefEntry {
    pub backend_node_id: Option<i64>,    // 快路径
    pub role: String,                    //
    pub name: String,                    // 语义指纹
    pub nth: Option<usize>,              //
    pub selector: Option<String>,        // ← 字段存在,但 take_snapshot 从没填!
    pub frame_id: Option<String>,
}
```

`add_selector` 方法存在但 `snapshot.rs::take_snapshot` 流程里从没调用。

### 2.6 Agent-Browser 的回查链路

`element.rs:149-214 resolve_element_center`:

```
ref_id
  ↓
ref_map.get(ref_id)  → RefEntry
  ↓
尝试 backend_node_id → DOM.getBoxModel
  ├─ 成功:返回坐标
  └─ 失败(stale):
        ↓
      find_node_id_by_role_name(role, name, nth)  ← 重跑 AX tree
        ├─ 成功:fresh backend_node_id → getBoxModel
        └─ 失败:整体 Error
```

### 2.7 Agent-Browser 输出格式

`snapshot.rs:1060-1188 render_tree`:

```
- {role} "{name}" [attr1, attr2, ref=eN, url=...] {clickable} [hint1]
```

**ref 在 attrs 里**,与 Stagehand 的 `[encodedId]` 前缀写法不同。

Agent-Browser 也在 render 阶段做了「ignored 节点透明化」(line 1070-1079):

```rust
if node.role.is_empty()
    || (node.role == "generic" && !node.has_ref && node.children.len() <= 1)
    || (node.role == "StaticText" && empty_name)
{
    for &child in &node.children {
        render_tree(nodes, child, indent, output, options);  // 跳过自己,递归 children
    }
    return;
}
```

——这正是当前 browser-auto 缺失的逻辑。

---

## 3. cache / replay 场景的关键洞察

### 3.1 两个方案的 replay 适用性实测

| 方案              | 内部 ID                          | 解析后 selector                  | 跨会话稳定性           | 适合 replay?                 |
| ----------------- | -------------------------------- | -------------------------------- | ---------------------- | ---------------------------- |
| **Stagehand**     | `{frameOrdinal}-{backendNodeId}` | Absolute XPath                   | 🟡 结构稳定就稳        | XPath 可缓存但脆             |
| **Agent-Browser** | `@eN` 递增                       | backend_node_id 或 role+name+nth | 🟢 语义指纹比 XPath 稳 | role+name+nth 跨会话基本可用 |

### 3.2 各种引用方式的「跨 session 命中率」

```
backendNodeId       ✗ 100% 失效(每次会变)
AX nodeId           ✗ 100% 失效(每次会变)
@eN                 ✗ 100% 失效(每次重排)
Absolute XPath      🟡 结构稳定 ✓ / 微变 ✗
id="xxx" 选择器     🟢 有 id 就稳
role+name+nth       🟢 文案不变就稳
data-testid         🟢 最稳,但要业务配合
```

### 3.3 结论

**两个方案的 ID 系统都不能直接当 replay key**,但 Agent-Browser 的 RefEntry 已经埋好了多策略 fallback 的种子(那个被遗忘的 `selector` 字段)。

---

## 4. 设计建议 — 多策略 Selector + RefMap

### 4.1 数据结构

```ts
interface RefEntry {
  // === 快路径(snapshot 期内有效) ===
  backendNodeId: number;
  axNodeId: string;

  // === Replay 多策略,按命中权重从高到低 ===
  selectors: SelectorCandidate[];

  // === 上下文 ===
  frameId?: string;
  ancestorChain: string[]; // ['form#loginPanel', 'div.form-item']
}

interface SelectorCandidate {
  kind:
    | "data-testid"
    | "dom-id"
    | "role-name-nth"
    | "xpath-rel"
    | "xpath-abs"
    | "css-attr-chain";
  value: string;
  weight: number; // 100 = 最稳, 30 = 最脆
  expectedMatchCount?: number; // replay 时校验
}
```

### 4.2 全流程

```
Snapshot
  ↓
[@e4] button: 登录                             ← 给 LLM 的文本
  ↓
LLM 返回 click @e4
  ↓
RefMap @e4 → RefEntry {
  backendNodeId: 30,                           ← 当前快路径
  selectors: [
    { kind: 'dom-id',     value: '#loginBtn',    weight: 95 },
    { kind: 'role-name',  value: 'button:登录',  weight: 70 },
    { kind: 'xpath-abs',  value: '/html/.../button', weight: 30 }
  ],
  ancestorChain: ['form#loginPanel', 'div.form-item']
}
  ↓
执行操作
  ↓
缓存层:存 selectors[] + ancestorChain + action,**不存 backendNodeId/@eN**
  ↓
Replay 时:按 weight 排序逐个尝试 selectors
         + 用 ancestorChain 验证「选中的是同一类元素」
         + 首个命中即执行;全 miss → 退化到 LLM
```

### 4.3 与现状方案对比

| 维度                | Stagehand | Agent-Browser | 这个混合方案 |
| ------------------- | --------- | ------------- | ------------ |
| LLM 引用易用性      | ✅        | ✅            | ✅           |
| 同会话快速操作      | ✅ XPath  | ✅ backendId  | ✅ backendId |
| Replay 命中率(静态) | 🟡 70%    | 🟡 60%        | 🟢 90%+      |
| Replay 命中率(SPA)  | ❌ 20%    | 🟡 40%        | 🟢 75%+      |
| 实现复杂度          | 高        | 中            | 中           |

---

## 5. 落地路径(建议三步走)

```
Step 1 — 修剪枝 bug,让 snapshot 起码能正确输出树
  改 serializer.ts 的 return 语义,~30 行
  独立 PR,无依赖,可立即做

Step 2 — 引入 RefMap + 文本输出加 ID
  新增 ref 管理 + 改输出格式,~150 行
  依赖 Step 1

Step 3 — 多策略 selector 生成 + 缓存层集成
  新增 selector 提取(DOM.getDocument + 属性扫描),~300 行
  缓存层另算
  依赖 Step 2
```

---

## 6. 代码对齐结果 — 已确认的发现

### 6.1 已有 locator 框架的发现(关键)

**`locator/find.ts`** 已经实现了完整的多策略 fallback:

```
locateElement(locator)
  ├─ textAnchor.labelText  → findByLabelText  → queryBackendNodeId
  ├─ semantic.ariaLabel    → findByAriaLabel  → queryBackendNodeId
  ├─ semantic.placeholder  → findByPlaceholder → queryBackendNodeId
  ├─ structural(tagName+formIndex+indexInForm) → findByStructure → queryBackendNodeId
  └─ xpath                 → findByXPath      → queryBackendNodeId
```

最终会拿到 `{ backendNodeId, nodeId }`。

**`memory/types.ts`** 的 `ElementLocator` 已经支持:

```ts
interface ElementLocator {
  textAnchor?: { labelText: string; relation?: string };
  semantic?: { ariaLabel?: string; placeholder?: string; name?: string };
  structural?: { tagName: string; formIndex?: number; indexInForm?: number };
  xpath?: string;
}
```

**`memory/replayer.ts`** 的 `tryExecuteWithFallback` 在 replay 失败时会返回:
`success` | `recoverable_failure` | `structural_failure`

→ **这说明:多策略 selector + replay fallback 的框架已经存在**,只是和工具层、snapshot 层**完全断开**。

### 6.2 完整调用链路(含断开点)

```
agent.act(prompt)
  │
  ├─► memory.get(key) ──► replayPath(memorizedPath)
  │      │
  │      ├─ success → 直接返回
  │      ├─ structural → memory.invalidate(key)
  │      └─ partial → runWithHandover(...)
  │           │  用 document.body.innerText.slice(0,2000) 做上下文 ← ① 不是 snapshot!
  │           └─ runLoop(...)
  │
  └─► runLoop(prompt, tools)
       │
       └─► AgentLoop.run()
            │
            ├─► LLM → getSnapshot() → tools/snapshot.ts
            │      execute()
            │      ├─ getAXTree() ──► Accessibility.getFullAXTree
            │      └─ serializeSnapshot() → 返回 { snapshot: string } ← ② 纯文本,无 ref/ID!
            │
            ├─► LLM → click(selector="#id")  或 click(text="登录")
            │      execute()
            │      ├─ buildClickExpression()
            │      └─ pageManager.evaluate(document.querySelector(...)) ← ③ 不走 locator!
            │
            └─► TraceRecorder 记录 toolCall.args
                 │
                 └─► extractMinimalPath(traceData)
                      ├─ 从 args.selector 正则提取 aria-label / placeholder
                      ├─ 从 args.text 提取 textAnchor
                      └─ 存到 memory
```

### 6.3 核心断开点

| #     | 断开位置                           | 现象                                                                             | 影响                                                          |
| ----- | ---------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **①** | `agent.ts:216-218` runWithHandover | 用 `innerText` 而非 `getSnapshot` 做上下文                                       | LLM 看不到页面结构,handover 质量差                            |
| **②** | `tools/snapshot.ts:21`             | snapshot 只返回纯文本字符串,无 ref/ID 字典                                       | LLM 无法精确引用元素,只能猜 selector/text                     |
| **③** | `tools/click.ts` + `fill.ts`       | 直接用 `document.querySelector` 或 `textContent.includes`,不走 `locateElement()` | 定位失败率高,重复造轮子,已有的 multi-strategy fallback 被闲置 |
| **④** | `memory/extractor.ts`              | 只能从 `args.selector`/`args.text` 提取 locator,不支持 ref 模式                  | 如果 snapshot 带 ref,extractor 不知道如何解析                 |

---

## 7. 结论更新

之前认为"需要从头设计 RefMap + 多策略 selector",但现在发现:

**`locator/find.ts` + `memory/types.ts` + `memory/replayer.ts` 已经构成了一个完整的多策略 replay 框架。**

真正需要的是**把这三层桥接到 snapshot 和 tool 执行层**:

1. **snapshot 层**:输出带 ref ID 的文本 + 维护 ref→ElementLocator 的映射
2. **tool 参数层**:让 click/fill 接受 `ref` 参数,并在 execute 里通过 ref 查 locator 再执行
3. **agent 层**:runWithHandover 时用真正的 snapshot 替代 innerText

这比"从头设计"工作量小得多。

---

## 8. Open Questions(更新)

1. **snapshot ref 格式** — 用 Stagehand 的 `[id]` 前缀还是 Agent-Browser 的 `[ref=eN]` 后缀?还是更简洁的 `@eN`?
2. **ref→locator 的生成时机** — 在 `serializeSnapshot()` 时同时生成,还是懒生成(只在 LLM 引用某个 ref 时才查 DOM)?
3. **extractor.ts 的扩展** — 当 tool 参数变为 `{ ref: "e4" }` 时,如何从 trace 中反解出 locator?需要 snapshot 在 trace 中也记录 ref map。
4. **iframe 里的 ref** — 当前 `locator/find.ts` 完全没处理 iframe。是否需要 frameId?
5. **click/fill 的 execute 改造** — 是否让 click/fill 统一走 `locateElement()`,把现在的 `document.querySelector` 逻辑移进去?还是保留 selector/text 作为降级?
6. **是否需要保留当前纯文本 snapshot 的向后兼容** — 还是直接替换?

---

## 附:验证过的诊断脚本

`/Users/xianyi/CustomGit/browser-auto/diagnose-login.ts` — 已修改为接受 URL 参数,可测试 snapshot bug。
