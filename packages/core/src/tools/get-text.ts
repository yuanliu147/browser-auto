import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import type { Tool } from "../loop/types.js";
import { resolveLocator } from "./_helpers.js";

export function createGetTextTool(pageManager: PageManager): Tool {
  return {
    name: "getText",
    description: "Get the text content of an element.",
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
      const content = await locator.first().textContent();
      return { text: content ?? "" };
    },
  };
}
