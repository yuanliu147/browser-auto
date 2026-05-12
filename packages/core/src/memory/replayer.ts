import type { CDPPageManager } from "../cdp/page.js";
import type { PathStep, MemorizedPath } from "./types.js";
import { locateElement } from "../locator/find.js";
import type { ElementLocator } from "../locator/types.js";
import {
  clickByBackendNodeId,
  fillByBackendNodeId,
  findBackendNodeIdBySelector,
} from "../interaction/index.js";

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

async function resolveReplayTarget(
  page: CDPPageManager,
  locator: ElementLocator | undefined,
  selector: string | undefined
): Promise<number | null> {
  if (locator && Object.keys(locator).length > 0) {
    try {
      const located = await locateElement(page, locator);
      return located.backendNodeId;
    } catch {
      // locator failed, fall through to selector
    }
  }
  if (selector) {
    return findBackendNodeIdBySelector(page, selector);
  }
  return null;
}

async function executeToolOnPage(
  tool: string,
  args: Record<string, unknown>,
  locator: ElementLocator | undefined,
  page: CDPPageManager
): Promise<unknown> {
  switch (tool) {
    case "navigate": {
      const url = args.url as string;
      await page.navigate(url);
      return { ok: true, url };
    }
    case "click": {
      const backendNodeId = await resolveReplayTarget(
        page,
        locator,
        args.selector as string | undefined
      );
      if (!backendNodeId) {
        throw new Error("Element not found for click");
      }
      await clickByBackendNodeId(page, backendNodeId);
      return { ok: true };
    }
    case "fill": {
      const backendNodeId = await resolveReplayTarget(
        page,
        locator,
        args.selector as string | undefined
      );
      if (!backendNodeId) {
        throw new Error("Element not found for fill");
      }
      const value = args.value as string;
      await fillByBackendNodeId(page, backendNodeId, value);
      return { ok: true };
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

async function tryExecuteWithFallback(
  step: PathStep,
  page: CDPPageManager
): Promise<ExecuteResult> {
  try {
    await executeToolOnPage(step.tool, step.args, step.locator, page);
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
