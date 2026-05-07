import { tool } from "ai";
import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import { resolveLocator } from "./_helpers.js";

export function createHoverTool(pageManager: PageManager) {
  return tool({
    description: "Hover over an element.",
    inputSchema: z.object({
      selector: z.string().optional().describe("CSS selector"),
      text: z.string().optional().describe("Visible text of the element"),
    }),
    execute: async ({ selector, text }) => {
      const page = await pageManager.getCurrent();
      const locator = resolveLocator(page, selector, text);
      await locator.first().hover();
      return { ok: true };
    },
  });
}
