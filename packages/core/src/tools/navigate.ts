import { tool } from "ai";
import { z } from "zod";
import type { PageManager } from "../browser/page.js";

export function createNavigateTool(pageManager: PageManager) {
  return tool({
    description: "Navigate to a URL in the current page.",
    inputSchema: z.object({
      url: z.string().describe("The URL to navigate to"),
    }),
    execute: async ({ url }) => {
      const page = await pageManager.getCurrent();
      await page.goto(url);
      return { ok: true, url: page.url() };
    },
  });
}
