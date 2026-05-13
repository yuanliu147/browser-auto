import type { CDPPageManager } from "../cdp/page.js";
import type { PathStep, MemorizedPath } from "./types.js";
import { click, fill, navigate, wait } from "../actions/index.js";
import { listTabs, newTab } from "../actions/tabs.js";

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

async function executeStepOnPage(
  step: PathStep,
  page: CDPPageManager
): Promise<unknown> {
  switch (step.tool) {
    case "navigate": {
      const url = step.args.url as string;
      return navigate(page, url);
    }
    case "click": {
      return click(
        page,
        step.locator,
        step.args.selector as string | undefined
      );
    }
    case "fill": {
      return fill(
        page,
        step.locator,
        step.args.selector as string | undefined,
        step.args.value as string
      );
    }
    case "waitFor": {
      const ms = step.args.ms as number | undefined;
      if (ms !== undefined) {
        return wait(page, undefined, ms);
      }
      return wait(page, step.args.selector as string | undefined, undefined);
    }
    case "tabs": {
      const action = step.args.action as string;
      if (action === "list") {
        return listTabs(page);
      }
      if (action === "new") {
        return newTab(page, step.args.url as string | undefined);
      }
      return { ok: true };
    }
    default:
      throw new Error(`Unknown tool: ${step.tool}`);
  }
}

async function tryExecuteWithFallback(
  step: PathStep,
  page: CDPPageManager
): Promise<ExecuteResult> {
  try {
    await executeStepOnPage(step, page);
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
