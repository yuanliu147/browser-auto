import type { CDPPageManager } from "../cdp/page.js";
import type { ElementDOMInfo } from "./adapter.js";

interface CDPFlattenedNode {
  backendNodeId?: number;
  localName?: string;
  nodeName?: string;
  nodeType?: number;
  attributes?: string[];
}

export interface AXNode {
  nodeId: string;
  role?: string;
  name?: string;
  value?: string;
  description?: string;
  properties?: Array<{
    name: string;
    value: { type: string; value?: unknown };
  }>;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
}

export interface AXTree {
  nodes: AXNode[];
  nodeMap: Map<string, AXNode>;
}

export async function getAXTree(page: CDPPageManager): Promise<AXTree> {
  const { nodes } = (await page.send("Accessibility.getFullAXTree", {})) as {
    nodes: Array<{
      nodeId: string;
      role?: { type: string; value?: string };
      name?: { type: string; value?: string };
      value?: { type: string; value?: unknown };
      description?: { type: string; value?: string };
      properties?: Array<{
        name: string;
        value: { type: string; value?: unknown };
      }>;
      childIds?: string[];
      backendDOMNodeId?: number;
      ignored?: boolean;
    }>;
  };

  const normalized: AXNode[] = nodes.map((n) => ({
    nodeId: n.nodeId,
    role: n.role?.value,
    name: n.name?.value,
    value: n.value?.value as string | undefined,
    description: n.description?.value,
    properties: n.properties,
    childIds: n.childIds,
    backendDOMNodeId: n.backendDOMNodeId,
    ignored: n.ignored,
  }));

  const nodeMap = new Map<string, AXNode>();
  for (const n of normalized) {
    nodeMap.set(n.nodeId, n);
  }

  return { nodes: normalized, nodeMap };
}

export function getNodeState(node: AXNode): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const prop of node.properties ?? []) {
    if (prop.value.type === "boolean") {
      state[prop.name] = prop.value.value === true;
    }
  }
  return state;
}

export async function collectDOMInfo(
  page: CDPPageManager,
  axNodes: AXNode[]
): Promise<Map<number, ElementDOMInfo>> {
  const idSet = new Set(
    axNodes
      .filter((n) => n.backendDOMNodeId !== undefined && n.backendDOMNodeId > 0)
      .map((n) => n.backendDOMNodeId!)
  );
  if (idSet.size === 0) return new Map();

  await page.send("DOM.enable", {});

  // Mark elements with JS onclick property so DOM.getFlattenedDocument
  // can see them (getAttribute only returns HTML attributes, not JS-set properties)
  await page.send("Runtime.evaluate", {
    expression: `document.querySelectorAll('*').forEach(function(el) {
      if (el.onclick) el.setAttribute('data-bx-onclick', '1');
    })`,
  });

  // Use generous depth to reach Cloudscape/AWS UI component internals
  const { nodes } = (await page.send("DOM.getFlattenedDocument", {
    depth: 32,
    pierce: true,
  })) as { nodes: CDPFlattenedNode[] };

  const map = new Map<number, ElementDOMInfo>();
  for (const cdpNode of nodes) {
    if (!cdpNode.backendNodeId || !idSet.has(cdpNode.backendNodeId)) continue;
    const attrs: Record<string, string> = {};
    const raw = cdpNode.attributes ?? [];
    for (let i = 0; i < raw.length - 1; i += 2) {
      attrs[raw[i]] = raw[i + 1];
    }
    map.set(cdpNode.backendNodeId, {
      tagName: cdpNode.localName ?? cdpNode.nodeName?.toLowerCase(),
      className: attrs["class"] ?? "",
      attributes: attrs,
    });
  }
  return map;
}
