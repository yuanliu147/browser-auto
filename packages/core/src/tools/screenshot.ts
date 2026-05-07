import { tool } from "ai";
import { z } from "zod";
import type { PageManager } from "../browser/page.js";

export function createScreenshotTool(pageManager: PageManager) {
  return tool({
    description:
      "Take a screenshot of the current page. Returns base64-encoded PNG.",
    inputSchema: z.object({}),
    execute: async () => {
      const page = await pageManager.getCurrent();
      const buf = await page.screenshot();
      return { base64: buf.toString("base64") };
    },
  });
}
