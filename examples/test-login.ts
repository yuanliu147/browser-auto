import "dotenv/config";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
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
  const dir = mkdtempSync(join(tmpdir(), "browser-auto-"));
  const file = join(dir, "login.html");
  writeFileSync(file, HTML);
  const url = pathToFileURL(file).href;

  const agent = await createBrowserAgent({ browser: { headless: false } });
  try {
    await agent.act(
      `打开 ${url}，在用户名输入框填入 admin，密码输入框填入 123456，点击登录按钮，确认 #out 元素文本为 OK 后调用 submitDone`
    );
    console.log("act() finished");
  } finally {
    await agent.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
