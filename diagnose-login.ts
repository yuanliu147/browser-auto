import {
  createBrowserConnection,
  closeBrowser,
} from "./packages/core/src/cdp/browser.js";
import { CDPPageManager } from "./packages/core/src/cdp/page.js";
import { getAXTree } from "./packages/core/src/snapshot/axtree.js";
import { serializeSnapshot } from "./packages/core/src/snapshot/serializer.js";
import {
  clickByBackendNodeId,
  fillByBackendNodeId,
} from "./packages/core/src/interaction/index.js";

const URL = process.argv[2] || "http://127.0.0.1:5500/examples/login-page.html";

async function queryBackendNodeId(
  page: CDPPageManager,
  selector: string
): Promise<number> {
  const { root } = (await page.send("DOM.getDocument", { depth: 0 })) as {
    root: { nodeId: number };
  };
  const { nodeId } = (await page.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  })) as { nodeId: number };
  if (!nodeId) throw new Error(`Selector not found: ${selector}`);
  const { node } = (await page.send("DOM.describeNode", { nodeId })) as {
    node: { backendNodeId?: number };
  };
  if (!node.backendNodeId) throw new Error(`No backendNodeId for: ${selector}`);
  return node.backendNodeId;
}

async function main() {
  const handles = await createBrowserConnection();
  const page = new CDPPageManager(handles.client);
  await page.init();

  try {
    console.log("[1] navigate ->", URL);
    await page.navigate(URL);
    await new Promise((r) => setTimeout(r, 1200));

    console.log("\n[2] getSnapshot with refs");
    const tree = await getAXTree(page);
    const out = serializeSnapshot(tree);
    console.log("  snapshot text:");
    console.log(
      out.text
        .split("\n")
        .map((l) => "  | " + l)
        .join("\n")
    );

    console.log("\n[3] refMap:");
    for (const [ref, locator] of out.refMap) {
      console.log(`  ${ref}:`, JSON.stringify(locator));
    }

    console.log("\n[4] Querying backendNodeIds via selector...");
    const accountId = await queryBackendNodeId(page, "#account");
    const passwordId = await queryBackendNodeId(page, "#password");
    const btnId = await queryBackendNodeId(page, "#loginBtn");
    console.log(`  #account backendNodeId: ${accountId}`);
    console.log(`  #password backendNodeId: ${passwordId}`);
    console.log(`  #loginBtn backendNodeId: ${btnId}`);

    console.log("\n[5] fill account via CDP...");
    await fillByBackendNodeId(page, accountId, "testuser");

    console.log("[6] fill password via CDP...");
    await fillByBackendNodeId(page, passwordId, "testpass");

    console.log("[7] click button via CDP...");
    await clickByBackendNodeId(page, btnId);

    await new Promise((r) => setTimeout(r, 500));

    console.log("\n[8] Verify page state after interactions");
    const afterTree = await getAXTree(page);
    const afterOut = serializeSnapshot(afterTree);
    console.log("  snapshot after click:");
    console.log(
      afterOut.text
        .split("\n")
        .slice(0, 20)
        .map((l) => "  | " + l)
        .join("\n")
    );

    console.log("\n[PASS] All interactions completed successfully via CDP");
  } finally {
    await closeBrowser(handles);
  }
}

main().catch((err) => {
  console.error("ERR:", err);
  process.exit(1);
});
