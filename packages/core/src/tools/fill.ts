import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import type { Tool } from "../loop/types.js";
import { resolveLocator } from "./_helpers.js";

export function createFillTool(pageManager: PageManager): Tool {
  return {
    name: "fill",
    description: "Fill a text input or textarea with the given value.",
    parameters: z.object({
      selector: z.string().optional().describe("CSS selector of the input"),
      text: z
        .string()
        .optional()
        .describe("Visible label or placeholder of the input"),
      value: z.string().describe("Value to fill in"),
    }),
    execute: async ({ selector, text, value }) => {
      const page = await pageManager.getCurrent();
      const locator = resolveLocator(
        page,
        selector as string | undefined,
        text as string | undefined
      );
      await locator.first().fill(value as string);
      return { ok: true };
    },
  };
}
