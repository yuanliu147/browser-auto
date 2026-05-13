import { z } from "zod";
import type { CDPPageManager } from "../cdp/page.js";
import type { Tool } from "../loop/types.js";
import { wait } from "../actions/wait.js";

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
    execute: async ({ selector, ms }, _context) => {
      return wait(
        pageManager,
        selector as string | undefined,
        ms as number | undefined
      );
    },
  };
}
