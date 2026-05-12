import "dotenv/config";
import { createBrowserAgent } from "../packages/core/src/index.js";

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function printReport(params: {
  success: boolean;
  wallMs: number;
  summary?: {
    traceId: string;
    instruction: string;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    success: boolean;
    finishReason: string;
    totalUsage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    outputDir: string;
  };
  pageState?: { url: string; title: string };
  error?: string;
}): void {
  const { success, wallMs, summary, pageState, error } = params;
  const w = 58;
  const line = "═".repeat(w);

  console.log(`╔${line}╗`);
  console.log(`║${pad(" PPRO 登录流程测试报告", w)}║`);
  console.log(`╠${line}╣`);

  // 执行结果
  const resultText = success ? "✅ 通过" : "❌ 失败";
  console.log(`║ ${pad("执行结果:", 10)} ${pad(resultText, w - 12)}║`);
  console.log(
    `║ ${pad("总耗时:", 10)} ${pad(formatDuration(wallMs), w - 12)}║`
  );

  if (summary) {
    console.log(
      `║ ${pad("LLM 耗时:", 10)} ${pad(formatDuration(summary.durationMs), w - 12)}║`
    );
    console.log(
      `║ ${pad("Token:", 10)} ${pad(
        `输入 ${summary.totalUsage.inputTokens} / 输出 ${summary.totalUsage.outputTokens} / 总计 ${summary.totalUsage.totalTokens}`,
        w - 12
      )}║`
    );
    console.log(
      `║ ${pad("结束原因:", 10)} ${pad(summary.finishReason, w - 12)}║`
    );
  }

  if (pageState) {
    console.log(`╠${line}╣`);
    console.log(`║${pad(" 页面最终状态", w)}║`);
    console.log(
      `║ ${pad("URL:", 10)} ${pad(pageState.url.slice(0, w - 12), w - 12)}║`
    );
    if (pageState.url.length > w - 12) {
      let rest = pageState.url.slice(w - 12);
      while (rest.length > 0) {
        console.log(`║ ${pad(" ", 10)} ${pad(rest.slice(0, w - 12), w - 12)}║`);
        rest = rest.slice(w - 12);
      }
    }
    console.log(`║ ${pad("Title:", 10)} ${pad(pageState.title, w - 12)}║`);
  }

  if (summary?.outputDir) {
    console.log(`╠${line}╣`);
    console.log(`║ ${pad("Trace:", 10)} ${pad(summary.outputDir, w - 12)}║`);
  }

  if (error) {
    console.log(`╠${line}╣`);
    console.log(`║${pad(" 错误信息", w)}║`);
    const errLines = error.split("\n").flatMap((l) => {
      const parts: string[] = [];
      while (l.length > 0) {
        parts.push(l.slice(0, w - 4));
        l = l.slice(w - 4);
      }
      return parts.length ? parts : [""];
    });
    for (const el of errLines.slice(0, 6)) {
      console.log(`║  ${pad(el, w - 4)}║`);
    }
    if (errLines.length > 6) {
      console.log(`║  ${pad(`... ${errLines.length - 6} more lines`, w - 4)}║`);
    }
  }

  console.log(`╚${line}╝`);
}

async function main() {
  const agent = await createBrowserAgent({
    // browser: { headless: false },
    trace: { outputDir: "./traces" },
  });

  const start = Date.now();
  let summary: Awaited<ReturnType<typeof agent.act>> | undefined;
  let pageState: Awaited<ReturnType<typeof agent.getPageState>> | undefined;
  let error: string | undefined;

  try {
    summary = await agent.act(
      `打开 https://login.dashboard.ppro.com/login?response_type=code&client_id=gna7218bpcktoja7gi7dhuo4b&redirect_uri=https%3A%2F%2Fdashboard.ppro.com%2Fapi%2Fauth%2Fcallback%2F&scope=email+profile+openid+aws.cognito.signin.user.admin，` +
        `在用户名/邮箱输入框填入 aaa@qq.com，` +
        `在密码输入框填入 qwer1234，` +
        `点击 show password 按钮，` +
        `点击 sign in 按钮，` +
        `等待页面跳转或响应后调用 submitDone`
    );

    pageState = await agent.getPageState();

    // 验证：如果 URL 仍停留在登录页，说明登录失败
    if (pageState.url.includes("login.dashboard.ppro.com/login")) {
      throw new Error("登录失败：页面仍停留在登录页");
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    try {
      pageState = await agent.getPageState();
    } catch {
      // ignore
    }
  } finally {
    const wallMs = Date.now() - start;
    await agent.close();

    printReport({
      success: !error,
      wallMs,
      summary: summary ?? undefined,
      pageState: pageState ?? undefined,
      error,
    });

    if (error) {
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
