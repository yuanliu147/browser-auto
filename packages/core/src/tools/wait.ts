import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import type { Tool } from "../loop/types.js";

export function createWaitForTool(pageManager: PageManager): Tool {
  return {
    name: "waitFor",
    description:
      "Wait for an element to be in a specific state, or wait for a fixed duration in milliseconds.",
    parameters: z.object({
      selector: z.string().optional().describe("CSS selector to wait for"),
      ms: z.number().optional().describe("Fixed wait time in milliseconds"),
      state: z
        .enum(["attached", "detached", "visible", "hidden"])
        .optional()
        .describe("Element state to wait for (defaults to visible)"),
    }),
    execute: async ({ selector, ms, state }) => {
      const page = await pageManager.getCurrent();
      if (selector) {
        await page
          .locator(selector as string)
          .first()
          .waitFor({
            state:
              (state as "attached" | "detached" | "visible" | "hidden") ??
              "visible",
          });
        return { ok: true };
      }
      if (ms !== undefined) {
        await page.waitForTimeout(ms as number);
        return { ok: true };
      }
      throw new Error("Provide either selector or ms");
    },
  };
}
