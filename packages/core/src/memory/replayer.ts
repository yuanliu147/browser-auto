import type { CDPPageManager } from "../cdp/page.js";
import type { PathStep, MemorizedPath } from "./types.js";

export type ReplayStatus = "success" | "partial" | "failed";

export interface ReplayResult {
  status: ReplayStatus;
  completedSteps?: number[];
  failedAt?: number;
  remainingSteps?: PathStep[];
  updatedPath?: MemorizedPath;
  reason?: string;
}

export interface ExecuteResult {
  status: "success" | "recoverable_failure" | "structural_failure";
  updatedSelector?: string;
  error?: string;
}

async function executeToolOnPage(
  tool: string,
  args: Record<string, unknown>,
  page: CDPPageManager
): Promise<unknown> {
  switch (tool) {
    case "navigate": {
      const url = args.url as string;
      await page.navigate(url);
      return { ok: true, url };
    }
    case "click": {
      const expression = buildClickExpression(
        args.selector as string | undefined,
        args.text as string | undefined
      );
      return page.evaluate(expression);
    }
    case "fill": {
      const expression = buildFillExpression(
        args.selector as string | undefined,
        args.text as string | undefined,
        args.value as string
      );
      return page.evaluate(expression);
    }
    case "waitFor": {
      const ms = args.ms as number | undefined;
      if (ms !== undefined) {
        await new Promise((r) => setTimeout(r, ms));
        return { ok: true };
      }
      return { ok: true };
    }
    case "tabs": {
      return { ok: true };
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

function buildClickExpression(
  selector: string | undefined,
  text: string | undefined
): string {
  if (selector) {
    return `
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return { ok: false, error: 'Element not found' };
        el.click();
        return { ok: true };
      })()
    `;
  }
  if (text) {
    return `
      (() => {
        const els = Array.from(document.querySelectorAll('*'));
        const el = els.find(e => e.textContent?.includes('${text.replace(/'/g, "\\'")}'));
        if (!el) return { ok: false, error: 'Element not found by text' };
        el.click();
        return { ok: true };
      })()
    `;
  }
  return `(() => ({ ok: false, error: 'No selector or text' }))()`;
}

function buildFillExpression(
  selector: string | undefined,
  text: string | undefined,
  value: string
): string {
  const escapedValue = value.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
  if (selector) {
    return `
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return { ok: false, error: 'Element not found' };
        el.value = '${escapedValue}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      })()
    `;
  }
  if (text) {
    return `
      (() => {
        const labels = Array.from(document.querySelectorAll('label'));
        const label = labels.find(l => l.textContent?.includes('${text.replace(/'/g, "\\'")}'));
        let el = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
        if (!el && label) el = label.nextElementSibling;
        if (!el) {
          const els = Array.from(document.querySelectorAll('input, textarea'));
          el = els.find(e => e.placeholder?.includes('${text.replace(/'/g, "\\'")}'));
        }
        if (!el) return { ok: false, error: 'Input not found' };
        el.value = '${escapedValue}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      })()
    `;
  }
  return `(() => ({ ok: false, error: 'No selector or text' }))()`;
}

async function tryExecuteWithFallback(
  step: PathStep,
  page: CDPPageManager
): Promise<ExecuteResult> {
  try {
    await executeToolOnPage(step.tool, step.args, page);
    return { status: "success" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("not found") ||
      msg.includes("locator") ||
      msg.includes("selector")
    ) {
      return { status: "recoverable_failure", error: msg };
    }
    return { status: "structural_failure", error: msg };
  }
}

export async function replayPath(
  path: MemorizedPath,
  pageManager: CDPPageManager
): Promise<ReplayResult> {
  const checkpoints: number[] = [];

  for (let i = 0; i < path.steps.length; i++) {
    const step = path.steps[i];

    try {
      const result = await tryExecuteWithFallback(step, pageManager);

      if (result.status === "success") {
        checkpoints.push(i);
        continue;
      }

      if (result.status === "recoverable_failure") {
        return {
          status: "partial",
          completedSteps: checkpoints,
          failedAt: i,
          remainingSteps: path.steps.slice(i),
          updatedPath: path,
        };
      }

      if (result.status === "structural_failure") {
        return {
          status: "failed",
          failedAt: i,
          reason: "structural",
        };
      }
    } catch (e) {
      return {
        status: "partial",
        completedSteps: checkpoints,
        failedAt: i,
        remainingSteps: path.steps.slice(i),
        updatedPath: path,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return { status: "success" };
}
