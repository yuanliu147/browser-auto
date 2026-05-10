import "dotenv/config";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createBrowserAgent } from "../packages/core/src/index.js";

const HTML = `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"/><title>新建用户</title></head>
<body>
  <h1>新建用户</h1>
  <form id="userForm">
    <div><label>用户名 <input id="username" class="ant-input" placeholder="请输入用户名"/></label></div>
    <div><label>邮箱 <input id="email" type="email" class="ant-input" placeholder="请输入邮箱"/></label></div>
    <div><label>部门
      <select id="dept" class="ant-select">
        <option value="">请选择</option>
        <option value="tech">技术部</option>
        <option value="product">产品部</option>
      </select>
    </label></div>
    <div><label>状态 <button type="button" id="status" class="ant-switch">开关</button></label></div>
    <div><label>备注 <textarea id="remark" class="ant-input" placeholder="请输入备注"></textarea></label></div>
    <button type="button" id="submitBtn" onclick="document.getElementById('out').textContent='创建成功：'+document.getElementById('username').value">提交</button>
  </form>
  <div id="out"></div>
</body></html>`;

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "browser-auto-"));
  const file = join(dir, "form.html");
  writeFileSync(file, HTML);
  const url = pathToFileURL(file).href;

  const agent = await createBrowserAgent({
    browser: { headless: false },
    trace: { outputDir: "./traces" },
  });

  const instruction = `打开 ${url}，在用户名输入框填入 testuser，在邮箱输入框填入 test@example.com，在部门下拉框选择技术部，点击状态开关，在备注文本域填入测试备注，点击提交按钮，确认 #out 元素文本包含"创建成功"后调用 submitDone`;

  try {
    console.log("=== 第一次执行（LLM 路径）===");
    const start1 = Date.now();
    await agent.act(instruction);
    const dur1 = Date.now() - start1;
    console.log(`第一次耗时: ${dur1}ms`);

    // 重置页面状态
    await agent["pageManager"].evaluate(`
      document.getElementById('username').value = '';
      document.getElementById('email').value = '';
      document.getElementById('dept').value = '';
      document.getElementById('remark').value = '';
      document.getElementById('out').textContent = '';
    `);
    console.log("页面状态已重置\n");

    console.log("=== 第二次执行（Memory Replay 路径）===");
    const start2 = Date.now();
    await agent.act(instruction);
    const dur2 = Date.now() - start2;
    console.log(`第二次耗时: ${dur2}ms`);

    if (dur2 < dur1 * 0.5) {
      console.log("✅ Memory replay 验证通过（第二次明显更快）");
    } else {
      console.log("⚠️ 第二次未明显更快，可能仍走了 LLM 路径");
    }
  } finally {
    await agent.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
