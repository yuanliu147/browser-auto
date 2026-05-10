import { z } from "zod";
import type { CDPPageManager } from "../cdp/page.js";
import type { Tool } from "../loop/types.js";

export function createScreenshotTool(pageManager: CDPPageManager): Tool {
  return {
    name: "screenshot",
    description:
      "Take a screenshot of the current page. Returns base64-encoded PNG.",
    parameters: z.object({}),
    execute: async () => {
      const data = await pageManager.screenshot();
      return { base64: data };
    },
  };
}
