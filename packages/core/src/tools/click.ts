import { tool } from "ai";
import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import { resolveLocator } from "./_helpers.js";

export function createClickTool(pageManager: PageManager) {
  return tool({
    description:
      "Click an element. Provide either selector (CSS) or text (visible text of the element).",
    inputSchema: z.object({
      selector: z.string().optional().describe("CSS selector"),
      text: z.string().optional().describe("Visible text of the element"),
    }),
    execute: async ({ selector, text }) => {
      const page = await pageManager.getCurrent();
      const locator = resolveLocator(page, selector, text);
      await locator.first().click();
      return { ok: true };
    },
  });
}
