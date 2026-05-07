import { tool } from "ai";
import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import { resolveLocator } from "./_helpers.js";

export function createSelectTool(pageManager: PageManager) {
  return tool({
    description: "Select an option in a <select> element.",
    inputSchema: z.object({
      selector: z.string().optional().describe("CSS selector of the <select>"),
      text: z.string().optional().describe("Visible label of the <select>"),
      value: z.string().describe("Option value or label to select"),
    }),
    execute: async ({ selector, text, value }) => {
      const page = await pageManager.getCurrent();
      const locator = resolveLocator(page, selector, text);
      await locator.first().selectOption(value);
      return { ok: true };
    },
  });
}
