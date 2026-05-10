import type { CDPPageManager } from "../cdp/page.js";

export interface DOMSnapshotData {
  documents: DocumentSnapshot[];
  strings: string[];
}

export interface DocumentSnapshot {
  documentURL: string;
  title: string;
  baseURL: string;
  nodes: NodeSnapshot[];
  layout: LayoutSnapshot[];
}

export interface NodeSnapshot {
  nodeType: number;
  nodeName: string;
  nodeValue?: string;
  attributes?: Record<string, string>;
  backendNodeId: number;
}

export interface LayoutSnapshot {
  backendNodeId: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  visible?: boolean;
}

export async function captureDOMSnapshot(
  page: CDPPageManager
): Promise<DOMSnapshotData> {
  const result = (await page.send("DOMSnapshot.captureSnapshot", {
    computedStyles: ["display", "visibility", "opacity"],
    includePaintOrder: true,
    includeDOMRects: true,
  })) as {
    documents: Array<{
      documentURL: string;
      title: string;
      baseURL: string;
      nodes: {
        nodeType: number[];
        nodeName: number[];
        nodeValue: number[];
        attributes: number[][];
        backendNodeId: number[];
      };
      layout: {
        nodeIndex: number[];
        bounds: number[][];
        stackingContexts: number[];
        text: number[];
      };
    }>;
    strings: string[];
  };

  const strings = result.strings;
  const documents: DocumentSnapshot[] = result.documents.map((doc) => {
    const nodes: NodeSnapshot[] = [];
    const nodeCount = doc.nodes.nodeType.length;
    for (let i = 0; i < nodeCount; i++) {
      const attrIndices = doc.nodes.attributes[i] ?? [];
      const attributes: Record<string, string> = {};
      for (let j = 0; j < attrIndices.length; j += 2) {
        const key = strings[attrIndices[j]];
        const val = strings[attrIndices[j + 1]];
        if (key) attributes[key] = val ?? "";
      }
      nodes.push({
        nodeType: doc.nodes.nodeType[i],
        nodeName: strings[doc.nodes.nodeName[i]] ?? "",
        nodeValue: strings[doc.nodes.nodeValue[i]],
        attributes,
        backendNodeId: doc.nodes.backendNodeId[i],
      });
    }

    const layout: LayoutSnapshot[] = [];
    for (let i = 0; i < doc.layout.nodeIndex.length; i++) {
      const nodeIdx = doc.layout.nodeIndex[i];
      const bounds = doc.layout.bounds[i];
      layout.push({
        backendNodeId: doc.nodes.backendNodeId[nodeIdx],
        boundingBox: {
          x: bounds[0],
          y: bounds[1],
          width: bounds[2],
          height: bounds[3],
        },
      });
    }

    return {
      documentURL: doc.documentURL,
      title: doc.title,
      baseURL: doc.baseURL,
      nodes,
      layout,
    };
  });

  return { documents, strings };
}
