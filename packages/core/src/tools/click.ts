import { z } from "zod";
import type { CDPPageManager } from "../cdp/page.js";
import type { Tool } from "../loop/types.js";
import { click } from "../actions/click.js";
import type { ElementLocator } from "../locator/types.js";

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
      let locator: ElementLocator | undefined;
      const refStr = ref as string | undefined;
      if (refStr) {
        const key = refStr.startsWith("@") ? refStr.slice(1) : refStr;
        locator = context.refMap?.get(key);
        if (!locator) {
          throw new Error(
            `Ref "${refStr}" not found in snapshot. Call getSnapshot first.`
          );
        }
      }
      return click(pageManager, locator, selector as string | undefined);
    },
  };
}
