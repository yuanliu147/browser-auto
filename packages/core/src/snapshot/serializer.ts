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

function hasDOMInteractionHandlers(domInfo?: ElementDOMInfo): boolean {
  if (!domInfo?.attributes) return false;
  if (domInfo.attributes["data-bx-onclick"] === "1") return true;
  const handlerAttrs = [
    "onclick",
    "ondblclick",
    "onmousedown",
    "onmouseup",
    "onkeydown",
    "onkeypress",
    "onkeyup",
    "onfocus",
    "onblur",
    "onchange",
    "oninput",
  ];
  for (const attr of handlerAttrs) {
    if (domInfo.attributes[attr] !== undefined) return true;
  }
  return false;
}

function isRefable(node: AXNode, domInfo?: ElementDOMInfo): boolean {
  if (node.role && INTERACTIVE_ROLES.has(node.role)) return true;
  if (hasDOMInteractionHandlers(domInfo)) return true;
  return false;
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

function shouldInclude(node: AXNode, parent?: AXNode): boolean {
  if (node.ignored) return false;
  // InlineTextBox always duplicates parent StaticText content
  if (node.role === "InlineTextBox") return false;
  // StaticText that duplicates parent's accessible name is noise
  if (node.role === "StaticText" && parent && node.name === parent.name)
    return false;
  if (!node.role && !node.name) return false;
  return true;
}

function serializeNode(
  node: AXNode,
  tree: AXTree,
  refState: RefState,
  domMap?: Map<number, ElementDOMInfo>,
  parent?: AXNode
): SerializedElement[] {
  if (!shouldInclude(node, parent)) {
    const kids: SerializedElement[] = [];
    for (const childId of node.childIds ?? []) {
      const child = tree.nodeMap.get(childId);
      if (child)
        kids.push(...serializeNode(child, tree, refState, domMap, node));
    }
    return kids;
  }

  const domInfo = node.backendDOMNodeId
    ? domMap?.get(node.backendDOMNodeId)
    : undefined;
  const { type } = inferComponentType(node, domInfo);

  // 分配 ref ID
  let ref: string | undefined;
  if (isRefable(node, domInfo)) {
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
    if (child)
      children.push(...serializeNode(child, tree, refState, domMap, node));
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

function toCompactText(
  el: SerializedElement,
  depth = 0,
  isRoot = false
): string {
  const indent = "  ".repeat(depth);

  // Omit RootWebArea — its children are the meaningful content
  if (isRoot && el.type === "RootWebArea") {
    return el.children
      .map((c) => toCompactText(c, depth))
      .filter(Boolean)
      .join("\n");
  }

  // Skip empty structural nodes (no ref, no name, no type)
  if (!el.ref && !el.name && !el.type) {
    return el.children
      .map((c) => toCompactText(c, depth))
      .filter(Boolean)
      .join("\n");
  }

  let line = `${indent}-`;
  if (el.ref) line += ` [@${el.ref}]`;
  if (el.name) line += ` ${el.name}`;
  line += ` [${el.type}`;
  if (el.state.length > 0) line += `, ${el.state.join(", ")}`;
  line += `]`;

  const lines = [line];
  for (const child of el.children) {
    const childText = toCompactText(child, depth + 1);
    if (childText) lines.push(childText);
  }
  return lines.join("\n");
}

function collapseTransparentGenerics(
  els: SerializedElement[]
): SerializedElement[] {
  return els.flatMap((el) => {
    el.children = collapseTransparentGenerics(el.children);
    const isTransparent =
      el.type === "generic" && !el.name && !el.ref && el.state.length === 0;
    if (isTransparent) return el.children;
    return [el];
  });
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

  const collapsed = collapseTransparentGenerics(roots);
  const text = collapsed
    .map((r) => toCompactText(r, 0, true))
    .filter(Boolean)
    .join("\n");
  return { text, elements: collapsed, refMap: refState.refMap };
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
