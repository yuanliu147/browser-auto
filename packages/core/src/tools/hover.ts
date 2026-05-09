import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import type { Tool } from "../loop/types.js";
import { resolveLocator } from "./_helpers.js";

export function createHoverTool(pageManager: PageManager): Tool {
  return {
    name: "hover",
    description: "Hover over an element.",
    parameters: z.object({
      selector: z.string().optional().describe("CSS selector"),
      text: z.string().optional().describe("Visible text of the element"),
    }),
    execute: async ({ selector, text }) => {
      const page = await pageManager.getCurrent();
      const locator = resolveLocator(
        page,
        selector as string | undefined,
        text as string | undefined
      );
      await locator.first().hover();
      return { ok: true };
    },
  };
}
