import "dotenv/config";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createBrowserAgent } from "../packages/core/src/index.js";
import { extractMinimalPath } from "../packages/core/src/memory/extractor.js";

const TEST_DIR = join(process.cwd(), ".test-memory-failure");

function cleanTestDir() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function writeHtml(file: string, content: string): string {
  writeFileSync(join(TEST_DIR, file), content);
  return pathToFileURL(join(TEST_DIR, file)).href;
}

function listTraceDirs(outputDir: string): string[] {
  if (!existsSync(outputDir)) return [];
  return readdirSync(outputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function readTraceSteps(outputDir: string): number {
  const dirs = listTraceDirs(outputDir);
  if (dirs.length === 0) return 0;
  const lastDir = join(outputDir, dirs[dirs.length - 1]);
  try {
    const trace = JSON.parse(readFileSync(join(lastDir, "trace.json"), "utf8"));
    return trace.steps?.length ?? 0;
  } catch {
    return 0;
  }
}

function inspectTrace(outputDir: string, label: string) {
  const dirs = listTraceDirs(outputDir);
  console.log(
    `  [${label}] trace dirs: ${dirs.length > 0 ? dirs.join(", ") : "none"}`
  );
  if (dirs.length > 0) {
    const lastDir = join(outputDir, dirs[dirs.length - 1]);
    try {
      const trace = JSON.parse(
        readFileSync(join(lastDir, "trace.json"), "utf8")
      );
      const toolCalls =
        trace.steps?.flatMap((s: any) =>
          s.toolCalls.map((tc: any) => tc.toolName)
        ) ?? [];
      console.log(
        `  [${label}] steps: ${trace.steps?.length ?? 0}, tools: [${toolCalls.join(", ")}]`
      );
    } catch (e) {
      console.log(`  [${label}] failed to read trace: ${e}`);
    }
  }
}

function verifyExtractedPath(traceFile: string, label: string) {
  try {
    const trace = JSON.parse(readFileSync(traceFile, "utf8"));
    const path = extractMinimalPath(trace);
    if (!path) {
      console.log(
        `  [${label}] extractMinimalPath: null (no memorizable path)`
      );
      return;
    }
    console.log(`  [${label}] memorized steps: ${path.steps.length}`);
    for (const step of path.steps) {
      const fb = step.selectorFallbacks?.length ?? 0;
      const hint = step.semanticHint
        ? JSON.stringify(step.semanticHint)
        : "none";
      console.log(
        `    - ${step.tool}(${JSON.stringify(step.args)}) | fallbacks:${fb} hint:${hint}`
      );
    }
  } catch (e) {
    console.log(`  [${label}] failed to verify path: ${e}`);
  }
}

// ───────────────────────────────────────────────────────────────
// Test 1: Structural failure (page completely changed)
// ───────────────────────────────────────────────────────────────

async function testStructuralFailure() {
  console.log("\n========================================");
  console.log("Test 1: Structural failure");
  console.log("========================================");

  const traceDir = "./traces/testStructuralFailure";
  if (existsSync(traceDir)) rmSync(traceDir, { recursive: true });

  const v1 = `
    <!doctype html>
    <html><body>
      <h1>Login</h1>
      <input id="u" name="username" />
      <input id="p" name="password" type="password" />
      <button id="b" type="button" onclick="document.getElementById('out').textContent='OK'">登录</button>
      <div id="out"></div>
    </body></html>
  `;

  const v2 = `
    <!doctype html>
    <html><body>
      <div class="auth-card">
        <h2>Login Portal</h2>
        <div class="field"><label>Account</label><input id="acc" name="login" /></div>
        <div class="field"><label>Secret</label><input id="sec" name="pwd" type="password" /></div>
        <button id="go" type="button" onclick="document.getElementById('out').textContent='OK'">Submit</button>
      </div>
      <div id="out"></div>
    </body></html>
  `;

  const url = writeHtml("structural.html", v1);
  const instruction = `打开 ${url}，在 #u 填入 admin，在 #p 填入 123456，点击 #b，确认 #out 文本为 OK 后调用 submitDone`;

  const agent = await createBrowserAgent({ trace: { outputDir: traceDir } });

  try {
    // First run: memory path with explicit selectors (#u, #p, #b)
    await agent.act(instruction);
    console.log("✓ First run completed");
    inspectTrace(traceDir, "first");

    const dirs1 = listTraceDirs(traceDir);
    if (dirs1.length > 0) {
      verifyExtractedPath(join(traceDir, dirs1[0], "trace.json"), "first path");
    }

    // Overwrite with completely different page
    writeHtml("structural.html", v2);
    if (existsSync(traceDir)) rmSync(traceDir, { recursive: true });

    // Second run: all memorized selectors (#u, #p, #b) are invalid
    await agent.act(instruction);
    console.log("✓ Second run completed");
    inspectTrace(traceDir, "second");

    const dirs2 = listTraceDirs(traceDir);
    if (dirs2.length > 0) {
      const steps2 = readTraceSteps(traceDir);
      if (steps2 > 5) {
        console.log(
          "  → structural failure confirmed: memory missed, LLM took over (many steps)"
        );
      } else {
        console.log(
          "  → WARNING: second run was short, may have unexpectedly succeeded from memory"
        );
      }
    } else {
      console.log(
        "  → WARNING: no trace for second run, memory may have directly succeeded (unexpected)"
      );
    }
  } finally {
    await agent.close();
  }
}

// ───────────────────────────────────────────────────────────────
// Test 2: Selector change with fallback
// ───────────────────────────────────────────────────────────────

async function testSelectorChangeWithFallback() {
  console.log("\n========================================");
  console.log("Test 2: Selector change (fallback)");
  console.log("========================================");

  const traceDir = "./traces/testSelectorChangeWithFallback";
  if (existsSync(traceDir)) rmSync(traceDir, { recursive: true });

  const v1 = `
    <!doctype html>
    <html><body>
      <form id="login">
        <input id="username-field" name="username" placeholder="Username" />
        <input id="password-field" name="password" type="password" placeholder="Password" />
        <button id="submit-btn" type="button" onclick="document.getElementById('out').textContent='OK'">登录</button>
      </form>
      <div id="out"></div>
    </body></html>
  `;

  const v2 = `
    <!doctype html>
    <html><body>
      <form id="login">
        <input id="user-input" name="username" placeholder="Username" />
        <input id="pass-input" name="password" type="password" placeholder="Password" />
        <button id="login-btn" type="button" onclick="document.getElementById('out').textContent='OK'">登录</button>
      </form>
      <div id="out"></div>
    </body></html>
  `;

  const url = writeHtml("fallback.html", v1);
  const instruction = `打开 ${url}，在 #username-field 填入 admin，在 #password-field 填入 123456，点击 #submit-btn，确认 #out 文本为 OK 后调用 submitDone`;

  const agent = await createBrowserAgent({ trace: { outputDir: traceDir } });

  try {
    // First run: memory path with explicit IDs
    await agent.act(instruction);
    console.log("✓ First run completed");
    inspectTrace(traceDir, "first");

    const dirs1 = listTraceDirs(traceDir);
    if (dirs1.length > 0) {
      verifyExtractedPath(join(traceDir, dirs1[0], "trace.json"), "first path");
    }

    // Change IDs but keep structure similar
    writeHtml("fallback.html", v2);
    if (existsSync(traceDir)) rmSync(traceDir, { recursive: true });

    // Second run: IDs changed. Fallback should try [id="..."] from selectorFallbacks
    await agent.act(instruction);
    console.log("✓ Second run completed");
    inspectTrace(traceDir, "second");

    const dirs2 = listTraceDirs(traceDir);
    if (dirs2.length === 0) {
      console.log(
        "  → fallback worked: no second trace, memory replay succeeded"
      );
    } else {
      const steps2 = readTraceSteps(traceDir);
      if (steps2 > 3) {
        console.log(
          "  → fallback may have failed: LLM took over (handover or fresh run)"
        );
      } else {
        console.log("  → unexpected: second run had trace but few steps");
      }
    }
  } finally {
    await agent.close();
  }
}

// ───────────────────────────────────────────────────────────────
// Test 3: Partial failure (single element changed, handover)
// ───────────────────────────────────────────────────────────────

async function testPartialFailureHandover() {
  console.log("\n========================================");
  console.log("Test 3: Partial failure (handover)");
  console.log("========================================");

  const traceDir = "./traces/testPartialFailureHandover";
  if (existsSync(traceDir)) rmSync(traceDir, { recursive: true });

  const v1 = `
    <!doctype html>
    <html><body>
      <input id="u" name="username" />
      <input id="p" name="password" type="password" />
      <button id="b" type="button" onclick="document.getElementById('out').textContent='OK'">登录</button>
      <div id="out"></div>
    </body></html>
  `;

  const v2 = `
    <!doctype html>
    <html><body>
      <input id="u" name="username" />
      <input id="p" name="password" type="password" />
      <button id="login-btn" type="button" onclick="document.getElementById('out').textContent='OK'">登录</button>
      <div id="out"></div>
    </body></html>
  `;

  const url = writeHtml("partial.html", v1);
  const instruction = `打开 ${url}，在 #u 填入 admin，在 #p 填入 123456，点击 #b，确认 #out 文本为 OK 后调用 submitDone`;

  const agent = await createBrowserAgent({ trace: { outputDir: traceDir } });

  try {
    // First run: memory path with #u, #p, #b
    await agent.act(instruction);
    console.log("✓ First run completed");
    inspectTrace(traceDir, "first");

    const dirs1 = listTraceDirs(traceDir);
    if (dirs1.length > 0) {
      verifyExtractedPath(join(traceDir, dirs1[0], "trace.json"), "first path");
    }

    // Change only button ID
    writeHtml("partial.html", v2);
    if (existsSync(traceDir)) rmSync(traceDir, { recursive: true });

    // Second run: #u and #p should replay, #b fails → handover
    await agent.act(instruction);
    console.log("✓ Second run completed");
    inspectTrace(traceDir, "second");

    const dirs2 = listTraceDirs(traceDir);
    if (dirs2.length > 0) {
      const steps2 = readTraceSteps(traceDir);
      // Handover should produce a trace, but with fewer steps than a full restart
      // because the first two fills were already done by replay
      if (steps2 >= 3 && steps2 <= 10) {
        console.log(
          "  → handover confirmed: LLM resumed from breakpoint (moderate steps)"
        );
      } else if (steps2 > 10) {
        console.log(
          "  → handover may have restarted from scratch (many steps)"
        );
      } else {
        console.log("  → unexpected: very few steps in second trace");
      }
    } else {
      console.log(
        "  → WARNING: no second trace. Either fallback worked or memory unexpectedly succeeded"
      );
    }
  } finally {
    await agent.close();
  }
}

// ───────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────

async function main() {
  cleanTestDir();

  await testStructuralFailure();
  await testSelectorChangeWithFallback();
  await testPartialFailureHandover();

  console.log("\n========================================");
  console.log("All tests completed");
  console.log("========================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
