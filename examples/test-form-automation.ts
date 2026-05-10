import "dotenv/config";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createBrowserAgent } from "../packages/core/src/index.js";

// 复用 test-form.html，你也可以直接用真实中后台 URL
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
  <iframe id="nested" srcdoc="&lt;input id='nestedInput' placeholder='iframe内输入'/&gt;" style="width:100%;height:80px;border:1px solid #ccc;margin-top:12px;"></iframe>
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

  try {
    await agent.act(
      `打开 ${url}，` +
        `在用户名输入框填入 testuser，` +
        `在邮箱输入框填入 test@example.com，` +
        `在部门下拉框选择技术部，` +
        `点击状态开关，` +
        `在备注文本域填入测试备注，` +
        `点击提交按钮，` +
        `确认 #out 元素文本包含"创建成功"后调用 submitDone`
    );
    console.log("✅ 表单自动化测试通过");
  } finally {
    await agent.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
