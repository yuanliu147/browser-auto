import type { CDPPageManager } from "../cdp/page.js";

export async function fillByBackendNodeId(
  pageManager: CDPPageManager,
  backendNodeId: number,
  text: string
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

    // 2. Focus, select all, clear value, and dispatch input event
    await pageManager.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function() {
        this.focus();
        this.select();
        this.value = '';
        this.dispatchEvent(new Event('input', { bubbles: true }));
      }`,
      arguments: [],
      awaitPromise: false,
      userGesture: true,
    });

    // 3. Insert text via CDP Input domain
    await pageManager.send("Input.insertText", { text });
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
