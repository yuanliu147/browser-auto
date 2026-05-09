import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import type { Tool } from "../loop/types.js";
import { resolveLocator } from "./_helpers.js";

export function createClickTool(pageManager: PageManager): Tool {
  return {
    name: "click",
    description:
      "Click an element. Provide either selector (CSS) or text (visible text of the element).",
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
      await locator.first().click();
      return { ok: true };
    },
  };
}
