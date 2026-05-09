import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import type { Tool } from "../loop/types.js";
import { resolveLocator } from "./_helpers.js";

export function createSelectTool(pageManager: PageManager): Tool {
  return {
    name: "select",
    description: "Select an option in a <select> element.",
    parameters: z.object({
      selector: z.string().optional().describe("CSS selector of the <select>"),
      text: z.string().optional().describe("Visible label of the <select>"),
      value: z.string().describe("Option value or label to select"),
    }),
    execute: async ({ selector, text, value }) => {
      const page = await pageManager.getCurrent();
      const locator = resolveLocator(
        page,
        selector as string | undefined,
        text as string | undefined
      );
      await locator.first().selectOption(value as string);
      return { ok: true };
    },
  };
}
