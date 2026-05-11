import type { AXNode, AXTree } from "./axtree.js";
import { inferComponentType, type ElementDOMInfo } from "./adapter.js";
import type { ElementLocator } from "../memory/types.js";

export interface SerializedElement {
  id: string;
  type: string;
  name: string;
  value?: string;
  state: string[];
  children: SerializedElement[];
  ref?: string;
}

export interface SnapshotOutput {
  text: string;
  elements: SerializedElement[];
  refMap: Map<string, ElementLocator>;
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "slider",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "switch",
  "searchbox",
  "spinbutton",
  "progressbar",
  "scrollbar",
  "listbox",
  "treeitem",
]);

function isInteractive(role?: string): boolean {
  return !!role && INTERACTIVE_ROLES.has(role);
}

function buildLocator(node: AXNode): ElementLocator {
  const locator: ElementLocator = {};
  if (node.name) {
    locator.semantic = { name: node.name };
    // textAnchor 作为 fallback：通过 label text 查找关联元素
    locator.textAnchor = { labelText: node.name };
  }
  return locator;
}

interface RefState {
  nextId: number;
  refMap: Map<string, ElementLocator>;
}

function shouldInclude(node: AXNode): boolean {
  if (node.ignored) return false;
  if (!node.role && !node.name) return false;
  return true;
}

function serializeNode(
  node: AXNode,
  tree: AXTree,
  refState: RefState,
  domMap?: Map<number, ElementDOMInfo>
): SerializedElement[] {
  if (!shouldInclude(node)) {
    // 透明化处理 ignored 节点：递归输出子节点而非切断子树
    const kids: SerializedElement[] = [];
    for (const childId of node.childIds ?? []) {
      const child = tree.nodeMap.get(childId);
      if (child) kids.push(...serializeNode(child, tree, refState, domMap));
    }
    return kids;
  }

  const domInfo = node.backendDOMNodeId
    ? domMap?.get(node.backendDOMNodeId)
    : undefined;
  const { type } = inferComponentType(node, domInfo);

  // 分配 ref ID
  let ref: string | undefined;
  if (isInteractive(node.role)) {
    ref = `e${refState.nextId++}`;
    refState.refMap.set(ref, buildLocator(node));
  }

  const state: string[] = [];
  for (const prop of node.properties ?? []) {
    if (prop.value.type === "boolean" && prop.value.value === true) {
      state.push(prop.name);
    }
  }
  if (node.value) state.push(`value=${node.value}`);

  const children: SerializedElement[] = [];
  for (const childId of node.childIds ?? []) {
    const child = tree.nodeMap.get(childId);
    if (child) children.push(...serializeNode(child, tree, refState, domMap));
  }

  return [
    {
      id: node.nodeId,
      type,
      name: node.name ?? "",
      value: node.value,
      state,
      children,
      ref,
    },
  ];
}

function toCompactText(el: SerializedElement, depth = 0): string {
  const indent = "  ".repeat(depth);

  // 跳过纯结构性空节点（无 ref、无 name、无 type）
  if (!el.ref && !el.name && !el.type) {
    return el.children
      .map((c) => toCompactText(c, depth))
      .filter(Boolean)
      .join("\n");
  }

  let line = `${indent}-`;
  if (el.ref) line += ` [@${el.ref}]`;
  if (el.name) line += ` ${el.name}`;
  if (el.type) line += ` [${el.type}`;
  if (el.state.length > 0) line += `, ${el.state.join(", ")}`;
  if (el.type) line += `]`;

  const lines = [line];
  for (const child of el.children) {
    const childText = toCompactText(child, depth + 1);
    if (childText) lines.push(childText);
  }
  return lines.join("\n");
}

export function serializeSnapshot(
  tree: AXTree,
  domMap?: Map<number, ElementDOMInfo>
): SnapshotOutput {
  const roots: SerializedElement[] = [];
  const visited = new Set<string>();
  const refState: RefState = { nextId: 1, refMap: new Map() };

  for (const node of tree.nodes) {
    if (visited.has(node.nodeId)) continue;
    const serialized = serializeNode(node, tree, refState, domMap);
    if (serialized.length > 0) {
      roots.push(...serialized);
      markVisited(node, tree, visited);
    }
  }

  const text = roots
    .map((r) => toCompactText(r))
    .filter(Boolean)
    .join("\n");
  return { text, elements: roots, refMap: refState.refMap };
}

function markVisited(node: AXNode, tree: AXTree, visited: Set<string>): void {
  visited.add(node.nodeId);
  for (const childId of node.childIds ?? []) {
    const child = tree.nodeMap.get(childId);
    if (child && !visited.has(child.nodeId)) {
      markVisited(child, tree, visited);
    }
  }
}
