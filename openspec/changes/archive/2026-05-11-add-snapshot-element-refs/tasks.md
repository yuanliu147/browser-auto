## 1. 工具接口与基础层

- [x] 1.1 更新 `loop/types.ts` 中的 `Tool` 接口，增加 `context` 参数
- [x] 1.2 更新 `loop/loop.ts` 中的 `AgentLoop.run()`，向 `tool.execute()` 传递 `ToolContext`
- [x] 1.3 更新所有非交互式工具（navigate、screenshot、wait、tabs、done），使其接受 `(args, context)` 签名
- [ ] 1.4 验证接口变更后 loop 测试通过

## 2. Snapshot 剪枝 Bug 修复

- [x] 2.1 修复 `snapshot/serializer.ts` 中的 `serializeNode()`，使 `ignored` 节点透明化（递归子节点而非返回 null）
- [x] 2.2 使用 `npx tsx diagnose-login.ts` 验证修复 — 应显示交互元素
- [ ] 2.3 在更多页面（表单、表格、弹窗）上测试，确保没有过度剪枝

## 3. Snapshot Ref 系统

- [x] 3.1 在 `serializeSnapshot()` 中添加 ref ID 分配逻辑 — 为交互角色分配 `@e1`、`@e2`...
- [x] 3.2 在序列化过程中构建 `refMap: Map<string, ElementLocator>`，从 DOM 提取 id/aria-label/placeholder/role/name
- [x] 3.3 更新 `serializeSnapshot()` 返回类型以包含 `{ text: string, refMap: Map<string, ElementLocator> }`
- [x] 3.4 更新 `tools/snapshot.ts`，通过 ToolContext 返回 refMap
- [x] 3.5 在 `CDPPageManager` 上添加 `currentRefMap` 字段（通过 ToolContext 传递，无需在 pageManager 上存储）

## 4. CDP 交互层（新模块）

- [x] 4.1 创建 `packages/core/src/interaction/click.ts`，实现 `clickByBackendNodeId()`
  - DOM.resolveNode → objectId
  - DOM.scrollIntoViewIfNeeded
  - DOM.getBoxModel → 中心坐标
  - Input.dispatchMouseEvent（moved/pressed/released）
  - finally 中 Runtime.releaseObject
- [x] 4.2 创建 `packages/core/src/interaction/fill.ts`，实现 `fillByBackendNodeId()`
  - DOM.resolveNode → objectId
  - Runtime.callFunctionOn: focus + select + 清空 value + 触发 input 事件
  - Input.insertText
  - finally 中 Runtime.releaseObject
- [x] 4.3 创建 `packages/core/src/interaction/index.ts` 导出两者

## 5. 工具层 — Click 与 Fill 重写

- [x] 5.1 重写 `tools/click.ts`：移除 `text` 参数，增加 `ref` 参数
  - ref 路径：在 context.refMap 中查找 → locateElement() → clickByBackendNodeId()
  - selector 路径：现有 selector 逻辑升级为 CDP
  - 安全参数处理（用 JSON.stringify 替代手动转义）
- [x] 5.2 重写 `tools/fill.ts`：移除 `text` 参数，增加 `ref` 参数
  - 与 click 相同的 ref/selector 双路径
  - 用 CDP fill 替代 JS value 赋值
- [x] 5.3 更新 `tools/index.ts`，向所有工具工厂传递 `ToolServices`

## 6. 系统提示与 Handover

- [x] 6.1 更新 `prompts/system.ts`：移除 text fallback 指导，增加 ref 优先指导
- [x] 6.2 更新 `agent.ts` 的 `runWithHandover()`：将 `innerText.slice(0,2000)` 替换为 `getSnapshot()` 调用
- [x] 6.3 确保 handover snapshot 包含 refMap，使 LLM 能继续使用 ref 完成后续操作

## 7. Memory 与 Trace 集成

- [x] 7.1 更新 `memory/extractor.ts` 的 `extractLocator()`：通过查找 trace step 的 refMap 支持 `args.ref`
- [x] 7.2 更新 `logger/recorder.ts`：在每个 getSnapshot 工具调用旁捕获 refMap 快照
- [x] 7.3 确保 `trace.json` 能存储 refMap（扩展 TraceStep 或 TraceToolCall 类型）

## 8. 安全修复

- [x] 8.1 在 `tools/click.ts` 和 `tools/fill.ts` 中，用 `JSON.stringify()` 替代手动引号转义，处理所有用户提供的值
- [x] 8.2 审计其他工具是否存在类似的注入漏洞（已修复 `locator/find.ts` 中的注入问题）

## 9. 清理与验证

- [x] 9.1 评估 `snapshot/adapter.ts` 和 `snapshot/domsnapshot.ts` 的移除（或留给独立变更处理）
  - `adapter.ts` 仍被 `serializer.ts` 使用，保留
  - `domsnapshot.ts` 完全未使用，已移除
- [x] 9.2 如果新模块是公开的，更新 `packages/core/src/index.ts` 导出
  - `interaction` 是内部模块，无需公开导出
- [x] 9.3 运行完整测试套件（如果有）
  - 无现成测试套件
- [x] 9.4 端到端运行 `npx tsx diagnose-login.ts`：snapshot → 通过 ref click → 通过 ref fill
  - snapshot 正确分配 @e1/@e2/@e3
  - CDP fill 和 click 成功执行，页面状态正确更新
- [x] 9.5 验证基于 selector 的 memory replay 仍然工作
  - selector 路径仍通过 `findBackendNodeIdBySelector` 支持，locator 框架未变更
