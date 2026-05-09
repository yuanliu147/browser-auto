import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createBrowserAgent } from "../packages/core/src/index.js";

const HTML = `<!doctype html>
<html lang="zh">
  <head>
    <meta charset="utf-8" />
    <title>Login</title>
  </head>
  <body>
    <h1>Login</h1>
    <form id="login">
      <label>用户名 <input id="u" name="username" /></label><br />
      <label>密码 <input id="p" name="password" type="password" /></label><br />
      <button id="b" type="button" onclick="document.getElementById('out').textContent='OK'">登录</button>
    </form>
    <div id="out"></div>
  </body>
</html>`;

async function main() {
  // Use a fixed file path so memory can replay navigate
  const testDir = join(process.cwd(), ".test-memory");
  mkdirSync(testDir, { recursive: true });
  const file = join(testDir, "login.html");
  writeFileSync(file, HTML);
  const url = pathToFileURL(file).href;

  const instruction = `打开 ${url}，在用户名输入框填入 admin，密码输入框填入 123456，点击登录按钮，确认 #out 元素文本为 OK 后调用 submitDone`;

  const agent = await createBrowserAgent({
    trace: { outputDir: "./traces" },
  });

  try {
    console.log("=== First run (should use LLM) ===");
    const start1 = Date.now();
    await agent.act(instruction);
    console.log(`First run took ${Date.now() - start1}ms`);

    console.log("\n=== Second run (should hit memory) ===");
    const start2 = Date.now();
    await agent.act(instruction);
    console.log(`Second run took ${Date.now() - start2}ms`);

    console.log("\n=== Third run (same instruction, memory hit again) ===");
    const start3 = Date.now();
    await agent.act(instruction);
    console.log(`Third run took ${Date.now() - start3}ms`);

    console.log("\nAll runs completed successfully!");
  } finally {
    await agent.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
