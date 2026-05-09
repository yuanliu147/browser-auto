import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import type { Tool } from "../loop/types.js";

export function createGetSnapshotTool(pageManager: PageManager): Tool {
  return {
    name: "getSnapshot",
    description:
      "Get a structured accessibility snapshot of the current page. Use this to understand the page layout before clicking/filling.",
    parameters: z.object({}),
    execute: async () => {
      const page = await pageManager.getCurrent();
      const snap = await page.locator("body").ariaSnapshot();
      return { snapshot: snap };
    },
  };
}
