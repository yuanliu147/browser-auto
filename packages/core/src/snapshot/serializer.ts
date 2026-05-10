import type { AXNode, AXTree } from "./axtree.js";
import { inferComponentType, type ElementDOMInfo } from "./adapter.js";

export interface SerializedElement {
  id: string;
  type: string;
  name: string;
  value?: string;
  state: string[];
  children: SerializedElement[];
}

export interface SnapshotOutput {
  text: string;
  elements: SerializedElement[];
}

function shouldInclude(node: AXNode): boolean {
  if (node.ignored) return false;
  if (!node.role && !node.name) return false;
  return true;
}

function serializeNode(
  node: AXNode,
  tree: AXTree,
  domMap?: Map<number, ElementDOMInfo>
): SerializedElement | null {
  if (!shouldInclude(node)) return null;

  const domInfo = node.backendDOMNodeId
    ? domMap?.get(node.backendDOMNodeId)
    : undefined;
  const { type } = inferComponentType(node, domInfo);

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
    if (child) {
      const serialized = serializeNode(child, tree, domMap);
      if (serialized) children.push(serialized);
    }
  }

  return {
    id: node.nodeId,
    type,
    name: node.name ?? "",
    value: node.value,
    state,
    children,
  };
}

function toCompactText(el: SerializedElement, depth = 0): string {
  const indent = "  ".repeat(depth);
  let line = `${indent}- ${el.name}`;
  if (el.name && el.type) line += ` [${el.type}`;
  if (el.state.length > 0) line += `, ${el.state.join(", ")}`;
  if (el.name && el.type) line += `]`;

  const lines = [line];
  for (const child of el.children) {
    lines.push(toCompactText(child, depth + 1));
  }
  return lines.join("\n");
}

export function serializeSnapshot(
  tree: AXTree,
  domMap?: Map<number, ElementDOMInfo>
): SnapshotOutput {
  const roots: SerializedElement[] = [];
  const visited = new Set<string>();

  for (const node of tree.nodes) {
    if (visited.has(node.nodeId)) continue;
    const serialized = serializeNode(node, tree, domMap);
    if (serialized) {
      roots.push(serialized);
      markVisited(node, tree, visited);
    }
  }

  const text = roots.map((r) => toCompactText(r)).join("\n");
  return { text, elements: roots };
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
