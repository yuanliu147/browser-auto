import { tool } from "ai";
import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import { resolveLocator } from "./_helpers.js";

export function createFillTool(pageManager: PageManager) {
  return tool({
    description: "Fill a text input or textarea with the given value.",
    inputSchema: z.object({
      selector: z.string().optional().describe("CSS selector of the input"),
      text: z
        .string()
        .optional()
        .describe("Visible label or placeholder of the input"),
      value: z.string().describe("Value to fill in"),
    }),
    execute: async ({ selector, text, value }) => {
      const page = await pageManager.getCurrent();
      const locator = resolveLocator(page, selector, text);
      await locator.first().fill(value);
      return { ok: true };
    },
  });
}
