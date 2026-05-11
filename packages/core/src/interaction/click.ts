import type { CDPPageManager } from "../cdp/page.js";

export async function clickByBackendNodeId(
  pageManager: CDPPageManager,
  backendNodeId: number
): Promise<void> {
  let objectId: string | undefined;

  try {
    // 1. Resolve backend node to remote object
    const resolveResult = (await pageManager.send("DOM.resolveNode", {
      backendNodeId,
    })) as { object?: { objectId?: string } };
    objectId = resolveResult.object?.objectId;
    if (!objectId) {
      throw new Error(`Failed to resolve backend node ${backendNodeId}`);
    }

    // 2. Scroll into view
    await pageManager.send("DOM.scrollIntoViewIfNeeded", {
      objectId,
    });

    // 3. Get box model for center coordinates
    const boxModel = (await pageManager.send("DOM.getBoxModel", {
      objectId,
    })) as {
      model: {
        content: number[];
        width: number;
        height: number;
      };
    };
    const content = boxModel.model.content;
    const x = content[0] + boxModel.model.width / 2;
    const y = content[1] + boxModel.model.height / 2;

    // 4. Dispatch mouse events
    await pageManager.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
    });
    await pageManager.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await pageManager.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  } finally {
    if (objectId) {
      try {
        await pageManager.send("Runtime.releaseObject", { objectId });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

export async function findBackendNodeIdBySelector(
  pageManager: CDPPageManager,
  selector: string
): Promise<number | null> {
  try {
    const { root } = (await pageManager.send("DOM.getDocument", {
      depth: 0,
    })) as { root: { nodeId: number } };

    const { nodeId } = (await pageManager.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    })) as { nodeId: number };

    if (!nodeId) return null;

    const { node } = (await pageManager.send("DOM.describeNode", {
      nodeId,
    })) as { node: { backendNodeId?: number } };

    return node.backendNodeId ?? null;
  } catch {
    return null;
  }
}
