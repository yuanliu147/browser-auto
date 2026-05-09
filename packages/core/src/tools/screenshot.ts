import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import type { Tool } from "../loop/types.js";

export function createScreenshotTool(pageManager: PageManager): Tool {
  return {
    name: "screenshot",
    description:
      "Take a screenshot of the current page. Returns base64-encoded PNG.",
    parameters: z.object({}),
    execute: async () => {
      const page = await pageManager.getCurrent();
      const buf = await page.screenshot();
      return { base64: buf.toString("base64") };
    },
  };
}
