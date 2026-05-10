import "dotenv/config";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createBrowserConnection,
  closeBrowser,
} from "../packages/core/src/cdp/browser.js";
import { CDPPageManager } from "../packages/core/src/cdp/page.js";
import { getAXTree } from "../packages/core/src/snapshot/axtree.js";
import { serializeSnapshot } from "../packages/core/src/snapshot/serializer.js";

const HTML = `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"/><title>Context Test</title></head>
<body>
  <h1>主页面</h1>
  <input id="mainInput" placeholder="主页面输入框" />
  <iframe id="nested" srcdoc="&lt;!DOCTYPE html&gt;&lt;html&gt;&lt;body&gt;&lt;h3&gt;iframe&lt;/h3&gt;&lt;input id='nestedInput' placeholder='iframe内输入'/&gt;&lt;/body&gt;&lt;/html&gt;" style="width:100%;height:100px;border:1px solid #ccc;margin-top:12px;"></iframe>
  <div id="shadowHost" style="margin-top:12px;"></div>
  <script>
    const host = document.getElementById('shadowHost');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<h4>Shadow DOM</h4><input id="shadowInput" placeholder="shadow内输入" />';
  </script>
</body></html>`;

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "browser-auto-"));
  const file = join(dir, "context.html");
  writeFileSync(file, HTML);
  const url = pathToFileURL(file).href;

  const handles = await createBrowserConnection();
  const page = new CDPPageManager(handles.client);
  await page.init();

  try {
    await page.navigate(url);
    await new Promise((r) => setTimeout(r, 500));

    // 1. 测试 Accessibility Tree 是否能捕获 iframe 和 shadow
    const tree = await getAXTree(page);
    console.log("=== Raw AX Nodes ===");
    for (const n of tree.nodes) {
      console.log(
        `  ${n.nodeId}: role=${n.role} name=${n.name} childIds=${n.childIds?.join(",")}`
      );
    }
    console.log("");

    const output = serializeSnapshot(tree);
    console.log("=== Accessibility Snapshot ===");
    console.log(output.text);
    console.log("");

    // 2. 测试主页面元素 evaluate
    const mainResult = await page.evaluate(`
      (() => {
        const el = document.querySelector('#mainInput');
        return { found: !!el, tag: el?.tagName };
      })()
    `);
    console.log("=== Main page element ===");
    console.log(JSON.stringify(mainResult));

    // 3. 获取 frame tree
    const frameTree = await page.getFrameTree();
    const { frameTree: ft } = frameTree as any;
    const frames: Array<{ id: string; url: string }> = [];
    function collect(f: any) {
      frames.push(f.frame);
      for (const c of f.childFrames ?? []) collect(c);
    }
    collect(ft);
    console.log("\n=== Frames ===");
    for (const f of frames) {
      console.log(`Frame ${f.id}: ${f.url}`);
    }

    // 4. 尝试获取 iframe 内的 accessibility tree（通过 Page.createIsolatedWorld 不行，需要 frame session）
    // 在 flatten 模式下，iframe 作为子 target，可以通过 Target.getTargets 找到
    const { targetInfos } = (await handles.client.send(
      "Target.getTargets"
    )) as any;
    console.log("\n=== Targets ===");
    for (const t of targetInfos) {
      console.log(`  type=${t.type} url=${t.url} tid=${t.targetId}`);
    }

    // 5. 尝试 attach 到 iframe target
    const iframeTarget = targetInfos.find((t: any) => t.type === "iframe");
    if (iframeTarget) {
      console.log("\n=== Attaching to iframe target ===");
      const { sessionId } = (await handles.client.send(
        "Target.attachToTarget",
        { targetId: iframeTarget.targetId, flatten: true }
      )) as any;
      console.log(`iframe sessionId: ${sessionId}`);

      // 通过 iframe session 获取 accessibility tree
      const { nodes } = (await handles.client.send(
        "Accessibility.getFullAXTree",
        {},
        sessionId
      )) as any;
      console.log(`iframe AX nodes count: ${nodes.length}`);
      for (const n of nodes.slice(0, 10)) {
        console.log(
          `  ${n.nodeId}: role=${n.role?.value} name=${n.name?.value}`
        );
      }

      // 通过 iframe session 执行 evaluate
      const { result } = (await handles.client.send(
        "Runtime.evaluate",
        {
          expression: `(() => { const el = document.querySelector('#nestedInput'); return { found: !!el, tag: el?.tagName }; })()`,
          returnByValue: true,
        },
        sessionId
      )) as any;
      console.log("\n=== Iframe element ===");
      console.log(JSON.stringify(result?.value));
    }

    // 6. 测试 shadow DOM 可访问性
    const shadowResult = await page.evaluate(`
      (() => {
        const host = document.querySelector('#shadowHost');
        const shadow = host?.shadowRoot;
        const input = shadow?.querySelector('#shadowInput');
        return { hasShadow: !!shadow, hasInput: !!input, tag: input?.tagName };
      })()
    `);
    console.log("\n=== Shadow DOM ===");
    console.log(JSON.stringify(shadowResult));
  } finally {
    await closeBrowser(handles);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
