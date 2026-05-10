import { chromium } from "playwright";
import CDP from "chrome-remote-interface";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Utilities ----
const now = () => performance.now();

function avg(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Serve the test page
function startServer(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const file = fs.readFileSync(path.join(__dirname, "test-page.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(file);
    });
    server.listen(port, () => resolve(server));
    server.on("error", reject);
  });
}

// ---- Playwright Tests ----
async function runPlaywrightTests(
  url: string
): Promise<Record<string, number>> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForLoadState("networkidle");

  const results: Record<string, number> = {};

  // Test 1: Enumerate all frames and count elements
  {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = now();
      const frames = page.frames();
      for (const frame of frames) {
        await frame
          .locator("*")
          .count()
          .catch(() => 0);
      }
      times.push(now() - t0);
    }
    results["pw_frame_enum"] = avg(times);
  }

  // Test 2: Query elements by id across frames
  {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = now();
      const frames = page.frames();
      for (const frame of frames) {
        for (let j = 0; j < 10; j++) {
          await frame
            .locator(`#a-item-${j}`)
            .count()
            .catch(() => 0);
        }
      }
      times.push(now() - t0);
    }
    results["pw_cross_frame_query"] = avg(times);
  }

  // Test 3: Get bounding boxes (high frequency)
  {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = now();
      const frames = page.frames();
      for (const frame of frames) {
        const items = await frame.locator(".item").all();
        for (const item of items.slice(0, 20)) {
          await item.boundingBox().catch(() => null);
        }
      }
      times.push(now() - t0);
    }
    results["pw_bounding_boxes"] = avg(times);
  }

  // Test 4: Evaluate JS in each frame (gather data-index values)
  {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = now();
      const frames = page.frames();
      for (const frame of frames) {
        await frame
          .evaluate(() => {
            return Array.from(document.querySelectorAll(".item")).map((el) =>
              el.getAttribute("data-index")
            );
          })
          .catch(() => []);
      }
      times.push(now() - t0);
    }
    results["pw_frame_eval"] = avg(times);
  }

  await browser.close();
  return results;
}

// ---- Native CDP Tests ----
async function runCDPTests(url: string): Promise<Record<string, number>> {
  // Launch Chromium with remote debugging on a random port
  const debugPort = 19222;
  const browser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${debugPort}`],
  });

  // Wait for debug server to be ready
  await new Promise((r) => setTimeout(r, 800));

  // Fetch the WebSocket debugger URL
  const versionRes = await fetch(`http://localhost:${debugPort}/json/version`);
  const version = await versionRes.json();
  const wsUrl = version.webSocketDebuggerUrl;

  // Connect to the browser via CDP
  const browserClient = await CDP({ port: debugPort, target: wsUrl });
  await browserClient.Target.setDiscoverTargets({ discover: true });

  // Create a new page
  const { targetId } = await browserClient.Target.createTarget({
    url: "about:blank",
  });

  // Wait for target to be available
  await new Promise((r) => setTimeout(r, 300));

  // Get the page's WS URL
  const listRes = await fetch(`http://localhost:${debugPort}/json/list`);
  const targets = await listRes.json();
  const pageTarget = targets.find((t: { id: string }) => t.id === targetId);
  const pageWsUrl = pageTarget?.webSocketDebuggerUrl;

  if (!pageWsUrl) {
    throw new Error("Could not find page WebSocket URL");
  }

  // Connect to the page
  const client = await CDP({ port: debugPort, target: pageWsUrl });
  const { Page, DOM, Runtime } = client;

  await Page.enable();
  await DOM.enable();
  await Runtime.enable();

  await Page.navigate({ url });
  await Page.loadEventFired();

  // Wait a bit for frames to settle
  await new Promise((r) => setTimeout(r, 800));

  const results: Record<string, number> = {};

  // Helper: get frame tree
  async function getFrameTree() {
    const { frameTree } = await Page.getFrameTree();
    return frameTree;
  }

  // Test 1: Enumerate all frames and count elements via CDP
  {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = now();
      const tree = await getFrameTree();

      async function countInFrame() {
        try {
          const { root } = await DOM.getDocument({ depth: -1 });
          let count = 0;
          function traverse(node: {
            children?: unknown[];
            shadowRoots?: unknown[];
            contentDocument?: unknown;
          }) {
            count++;
            if (node.children) node.children.forEach(traverse);
            if (node.shadowRoots) node.shadowRoots.forEach(traverse);
            if (node.contentDocument) traverse(node.contentDocument);
          }
          traverse(root);
          return count;
        } catch {
          return 0;
        }
      }

      await countInFrame();
      if (tree.childFrames) {
        for (let ci = 0; ci < tree.childFrames.length; ci++) {
          await countInFrame();
        }
      }
      times.push(now() - t0);
    }
    results["cdp_frame_enum"] = avg(times);
  }

  // Test 2: Query elements across frames using Runtime.evaluate
  {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = now();
      const tree = await getFrameTree();
      const frameIds: string[] = [tree.frame.id];
      if (tree.childFrames) {
        tree.childFrames.forEach((c: { frame: { id: string } }) =>
          frameIds.push(c.frame.id)
        );
      }

      for (let fi = 0; fi < frameIds.length; fi++) {
        for (let j = 0; j < 10; j++) {
          try {
            await Runtime.evaluate({
              expression: `document.querySelector('#a-item-${j}') ? 1 : 0`,
            });
          } catch {
            // ignore
          }
        }
      }
      times.push(now() - t0);
    }
    results["cdp_cross_frame_query"] = avg(times);
  }

  // Test 3: Get bounding boxes via CDP (DOM.getBoxModel)
  {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = now();
      try {
        const { root } = await DOM.getDocument({ depth: 2 });
        const nodeIds: number[] = [];
        async function findItems(node: {
          nodeName?: string;
          attributes?: string[];
          nodeId?: number;
          children?: unknown[];
        }) {
          if (node.nodeName === "DIV") {
            const attrs = node.attributes || [];
            for (let k = 0; k < attrs.length; k += 2) {
              if (attrs[k] === "class" && attrs[k + 1]?.includes("item")) {
                nodeIds.push(node.nodeId ?? 0);
                break;
              }
            }
          }
          if (node.children) {
            for (const child of node.children)
              await findItems(
                child as {
                  nodeName?: string;
                  attributes?: string[];
                  nodeId?: number;
                  children?: unknown[];
                }
              );
          }
        }
        await findItems(root);
        for (const nid of nodeIds.slice(0, 20)) {
          try {
            await DOM.getBoxModel({ nodeId: nid });
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
      times.push(now() - t0);
    }
    results["cdp_bounding_boxes"] = avg(times);
  }

  // Test 4: Evaluate JS in frame contexts
  {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = now();
      try {
        await Runtime.evaluate({
          expression: `Array.from(document.querySelectorAll('.item')).map(el => el.getAttribute('data-index'))`,
          returnByValue: true,
        });
      } catch {
        // ignore
      }
      times.push(now() - t0);
    }
    results["cdp_frame_eval"] = avg(times);
  }

  await client.close();
  await browserClient.close();
  await browser.close();

  return results;
}

// ---- Main ----
async function main() {
  const port = 9877;
  const server = await startServer(port);
  const url = `http://localhost:${port}/test-page.html`;

  console.log("Running Playwright tests...");
  const pwResults = await runPlaywrightTests(url);

  console.log("Running CDP tests...");
  const cdpResults = await runCDPTests(url);

  server.close();

  // Print results
  console.log("\n========== RESULTS (ms) ==========");
  console.log(
    `${"Test".padEnd(28)} ${"Playwright".padStart(12)} ${"Native CDP".padStart(12)} ${"Ratio".padStart(8)}`
  );
  console.log("-".repeat(64));

  const keys = Object.keys(pwResults);
  for (const key of keys) {
    const pw = pwResults[key];
    const cdpKey = key.replace("pw_", "cdp_");
    const cdp = cdpResults[cdpKey] ?? 0;
    const ratio = cdp > 0 ? (pw / cdp).toFixed(2) + "x" : "N/A";
    console.log(
      `${key.padEnd(28)} ${pw.toFixed(2).padStart(12)} ${cdp.toFixed(2).padStart(12)} ${ratio.padStart(8)}`
    );
  }

  // Save JSON
  const output = {
    timestamp: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
    },
    playwright: pwResults,
    cdp: cdpResults,
  };
  fs.writeFileSync(
    path.join(__dirname, "results.json"),
    JSON.stringify(output, null, 2)
  );
  console.log("\nResults saved to benchmark/results.json");
}

main().catch(console.error);
