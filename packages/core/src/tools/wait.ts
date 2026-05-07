import { tool } from "ai";
import { z } from "zod";
import type { PageManager } from "../browser/page.js";

export function createWaitForTool(pageManager: PageManager) {
  return tool({
    description:
      "Wait for an element to be in a specific state, or wait for a fixed duration in milliseconds.",
    inputSchema: z.object({
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
          .locator(selector)
          .first()
          .waitFor({ state: state ?? "visible" });
        return { ok: true };
      }
      if (ms !== undefined) {
        await page.waitForTimeout(ms);
        return { ok: true };
      }
      throw new Error("Provide either selector or ms");
    },
  });
}
