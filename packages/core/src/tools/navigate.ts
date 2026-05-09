import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import type { Tool } from "../loop/types.js";

export function createNavigateTool(pageManager: PageManager): Tool {
  return {
    name: "navigate",
    description: "Navigate to a URL in the current page.",
    parameters: z.object({
      url: z.string().describe("The URL to navigate to"),
    }),
    execute: async ({ url }) => {
      const page = await pageManager.getCurrent();
      await page.goto(url as string);
      return { ok: true, url: page.url() };
    },
  };
}
