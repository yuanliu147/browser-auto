import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CDPPageManager } from "../cdp/page.js";
import type { TraceData, TraceScreenshotInfo } from "./types.js";

export const INTERACTION_TOOLS = new Set(["click", "fill"]);

export function isInteractionTool(toolName: string): boolean {
  return INTERACTION_TOOLS.has(toolName);
}

export function instructionSlug(instruction: string, maxLen = 15): string {
  return instruction
    .slice(0, maxLen)
    .replace(/\s+/g, "-")
    .replace(/[^\w一-龥-]/g, "")
    .replace(/^-+|-+$/g, "");
}

export function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}${m}${s}`;
}

export async function createTraceDir(
  outputDir: string,
  seq: number,
  instruction: string
): Promise<string> {
  const slug = instructionSlug(instruction);
  const ts = formatTime(new Date());
  const dirName = `${String(seq).padStart(3, "0")}-${slug || "act"}-${ts}`;
  const dir = join(outputDir, dirName);
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "screenshots"), { recursive: true });
  return dir;
}

export async function takeScreenshot(
  pageManager: CDPPageManager,
  dir: string,
  filename: string
): Promise<TraceScreenshotInfo> {
  try {
    const { data } = (await pageManager.send("Page.captureScreenshot")) as {
      data: string;
    };
    const buf = Buffer.from(data, "base64");
    const filepath = join(dir, "screenshots", filename);
    await writeFile(filepath, buf);
    return { path: `screenshots/${filename}` };
  } catch (err) {
    return {
      path: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function generateLogText(trace: TraceData): string {
  const lines: string[] = [];
  const fmt = (d: string) => d.replace("T", " ").split(".")[0];

  lines.push(`Trace: ${trace.traceId}`);
  lines.push(`Instruction: ${trace.instruction}`);
  lines.push(`Started: ${fmt(trace.startedAt)}`);
  lines.push(`Ended: ${fmt(trace.endedAt)}`);
  lines.push(`Duration: ${trace.durationMs}ms`);
  lines.push(`Success: ${trace.success}`);
  lines.push(`FinishReason: ${trace.finishReason}`);
  lines.push(
    `Tokens: ${trace.totalUsage.inputTokens} input / ${trace.totalUsage.outputTokens} output / ${trace.totalUsage.totalTokens} total`
  );
  lines.push("-".repeat(60));

  for (const step of trace.steps) {
    lines.push(
      `Step ${step.stepNumber}${step.reasoningText ? ` | reasoning: ${step.reasoningText.slice(0, 80)}` : ""}`
    );
    for (const tc of step.toolCalls) {
      const icon = tc.success ? "✓" : "✗";
      lines.push(
        `  → ${tc.toolName}(${JSON.stringify(tc.args)}) ${icon} ${tc.durationMs}ms`
      );
      if (tc.screenshotBefore?.path) {
        lines.push(`    📷 before: ${tc.screenshotBefore.path}`);
      }
      if (tc.screenshotAfter?.path) {
        lines.push(`    📷 after:  ${tc.screenshotAfter.path}`);
      }
      if (!tc.success && tc.result) {
        lines.push(`    error: ${JSON.stringify(tc.result)}`);
      }
    }
  }

  lines.push("-".repeat(60));
  lines.push("Trace complete");
  return lines.join("\n") + "\n";
}
