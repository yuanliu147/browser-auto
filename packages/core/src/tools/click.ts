import { z } from "zod";
import type { CDPPageManager } from "../cdp/page.js";
import type { Tool } from "../loop/types.js";
import { locateElement } from "../locator/find.js";
import {
  clickByBackendNodeId,
  findBackendNodeIdBySelector,
} from "../interaction/index.js";

export function createClickTool(pageManager: CDPPageManager): Tool {
  return {
    name: "click",
    description:
      "Click an interactive element. Provide either ref (preferred, from snapshot) or selector (CSS).",
    parameters: z.object({
      ref: z
        .string()
        .optional()
        .describe("Element ref ID from snapshot, e.g. @e1"),
      selector: z.string().optional().describe("CSS selector"),
    }),
    execute: async ({ ref, selector }, context) => {
      const backendNodeId = await resolveTarget(
        pageManager,
        context.refMap,
        ref as string | undefined,
        selector as string | undefined
      );
      if (!backendNodeId) {
        throw new Error(
          `Element not found: ref=${ref ?? "none"}, selector=${selector ?? "none"}`
        );
      }
      await clickByBackendNodeId(pageManager, backendNodeId);
      return { ok: true };
    },
  };
}

async function resolveTarget(
  pageManager: CDPPageManager,
  refMap: Map<string, import("../locator/types.js").ElementLocator> | undefined,
  ref: string | undefined,
  selector: string | undefined
): Promise<number | null> {
  if (ref) {
    const key = ref.startsWith("@") ? ref.slice(1) : ref;
    const locator = refMap?.get(key);
    if (!locator) {
      throw new Error(
        `Ref "${ref}" not found in snapshot. Call getSnapshot first.`
      );
    }
    const located = await locateElement(pageManager, locator);
    return located.backendNodeId;
  }
  if (selector) {
    return findBackendNodeIdBySelector(pageManager, selector);
  }
  return null;
}
