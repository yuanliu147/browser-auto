import type { CDPPageManager } from "../cdp/page.js";

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
