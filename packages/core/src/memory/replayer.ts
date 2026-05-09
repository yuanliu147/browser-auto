import type { Page } from "playwright";
import type { PageManager } from "../browser/page.js";
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
  page: Page
): Promise<unknown> {
  switch (tool) {
    case "navigate": {
      const url = args.url as string;
      await page.goto(url);
      return { ok: true, url: page.url() };
    }
    case "click": {
      const selector = args.selector as string | undefined;
      const text = args.text as string | undefined;
      const locator = selector
        ? page.locator(selector)
        : text
          ? page.getByText(text, { exact: false })
          : null;
      if (!locator) throw new Error("click requires selector or text");
      await locator.first().click();
      return { ok: true };
    }
    case "fill": {
      const selector = args.selector as string | undefined;
      const text = args.text as string | undefined;
      const value = args.value as string;
      const locator = selector
        ? page.locator(selector)
        : text
          ? page.getByText(text, { exact: false })
          : null;
      if (!locator) throw new Error("fill requires selector or text");
      await locator.first().fill(value);
      return { ok: true };
    }
    case "press": {
      const key = args.key as string;
      await page.keyboard.press(key);
      return { ok: true };
    }
    case "hover": {
      const selector = args.selector as string | undefined;
      const text = args.text as string | undefined;
      const locator = selector
        ? page.locator(selector)
        : text
          ? page.getByText(text, { exact: false })
          : null;
      if (!locator) throw new Error("hover requires selector or text");
      await locator.first().hover();
      return { ok: true };
    }
    case "select": {
      const selector = args.selector as string | undefined;
      const text = args.text as string | undefined;
      const value = args.value as string;
      const locator = selector
        ? page.locator(selector)
        : text
          ? page.getByText(text, { exact: false })
          : null;
      if (!locator) throw new Error("select requires selector or text");
      await locator.first().selectOption(value);
      return { ok: true };
    }
    case "scroll": {
      const direction = args.direction as "up" | "down";
      const amount = (args.amount as number) ?? 500;
      const dy = direction === "down" ? amount : -amount;
      await page.evaluate((d) => window.scrollBy(0, d), dy);
      return { ok: true };
    }
    case "tabs": {
      // tabs handled separately via pageManager
      throw new Error("tabs tool not supported in replay");
    }
    case "waitFor": {
      const selector = args.selector as string | undefined;
      const ms = args.ms as number | undefined;
      const state = args.state as string | undefined;
      if (selector) {
        await page
          .locator(selector)
          .first()
          .waitFor({
            state:
              (state as "attached" | "detached" | "visible" | "hidden") ??
              "visible",
          });
        return { ok: true };
      }
      if (ms !== undefined) {
        await page.waitForTimeout(ms);
        return { ok: true };
      }
      throw new Error("waitFor requires selector or ms");
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

async function tryExecuteWithFallback(
  step: PathStep,
  page: Page
): Promise<ExecuteResult> {
  const selector = step.args.selector as string | undefined;
  const needsSelector = [
    "click",
    "fill",
    "hover",
    "select",
    "waitFor",
  ].includes(step.tool);
  const hasLocator = selector || step.args.text;

  // Direct execution (no selector needed or locator provided)
  if (!needsSelector || hasLocator) {
    try {
      await executeToolOnPage(step.tool, step.args, page);
      return { status: "success" };
    } catch (e) {
      if (!needsSelector) {
        // Tools that don't need selectors fail for non-locator reasons
        return { status: "recoverable_failure" };
      }
      if (!isLocatorError(e)) throw e;
    }
  }

  // L1: fallback selectors
  for (const fallback of step.selectorFallbacks ?? []) {
    try {
      const argsWithFallback = { ...step.args, selector: fallback };
      await executeToolOnPage(step.tool, argsWithFallback, page);
      return { status: "success", updatedSelector: fallback };
    } catch {
      // try next
    }
  }

  // L2: Playwright built-in strategies
  const hint = step.semanticHint;
  if (
    hint?.ariaLabel &&
    (step.tool === "click" ||
      step.tool === "fill" ||
      step.tool === "hover" ||
      step.tool === "select")
  ) {
    try {
      const argsWithLabel = {
        ...step.args,
        selector: undefined,
        text: undefined,
      };
      const locator = page.getByLabel(hint.ariaLabel);
      await executeLocatorAction(step.tool, locator, argsWithLabel);
      return {
        status: "success",
        updatedSelector: `getByLabel("${hint.ariaLabel}")`,
      };
    } catch {
      // try next
    }
  }

  if (hint?.nearText && (step.tool === "click" || step.tool === "fill")) {
    try {
      const argsWithText = {
        ...step.args,
        selector: undefined,
        text: hint.nearText,
      };
      await executeToolOnPage(step.tool, argsWithText, page);
      return { status: "success" };
    } catch {
      // try next
    }
  }

  if (hint?.placeholder && step.tool === "fill") {
    try {
      const locator = page.getByPlaceholder(hint.placeholder);
      await locator.first().fill((step.args.value as string) ?? "");
      return {
        status: "success",
        updatedSelector: `getByPlaceholder("${hint.placeholder}")`,
      };
    } catch {
      // try next
    }
  }

  // Classify failure
  return { status: "recoverable_failure" };
}

async function executeLocatorAction(
  tool: string,
  locator: ReturnType<Page["locator"]>,
  args: Record<string, unknown>
): Promise<void> {
  const first = locator.first();
  switch (tool) {
    case "click":
      await first.click();
      break;
    case "fill":
      await first.fill((args.value as string) ?? "");
      break;
    case "hover":
      await first.hover();
      break;
    case "select":
      await first.selectOption((args.value as string) ?? "");
      break;
    default:
      throw new Error(`Unsupported tool for locator action: ${tool}`);
  }
}

function isLocatorError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("locator") ||
    msg.includes("selector") ||
    msg.includes("timeout") ||
    msg.includes("Target closed")
  );
}

export async function replayPath(
  path: MemorizedPath,
  pageManager: PageManager
): Promise<ReplayResult> {
  const checkpoints: number[] = [];

  for (let i = 0; i < path.steps.length; i++) {
    const step = path.steps[i];
    const page = await pageManager.getCurrent();

    try {
      const result = await tryExecuteWithFallback(step, page);

      if (result.status === "success") {
        checkpoints.push(i);
        if (result.updatedSelector) {
          step.selectorFallbacks = step.selectorFallbacks ?? [];
          if (!step.selectorFallbacks.includes(result.updatedSelector)) {
            step.selectorFallbacks.unshift(result.updatedSelector);
          }
        }
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
