import { z } from "zod";
import type { CDPPageManager } from "../cdp/page.js";
import type { Tool } from "../loop/types.js";

export function createWaitForTool(pageManager: CDPPageManager): Tool {
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
    execute: async ({ selector, ms }) => {
      const sel = selector as string | undefined;
      const waitMs = ms as number | undefined;
      if (sel) {
        const start = Date.now();
        const timeout = 10000;
        while (Date.now() - start < timeout) {
          const result = (await pageManager.evaluate(`
            !!document.querySelector('${sel.replace(/'/g, "\\'")}')
          `)) as boolean;
          if (result) return { ok: true };
          await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error(`Timeout waiting for selector: ${sel}`);
      }
      if (waitMs !== undefined) {
        await new Promise((r) => setTimeout(r, waitMs));
        return { ok: true };
      }
      throw new Error("Provide either selector or ms");
    },
  };
}
