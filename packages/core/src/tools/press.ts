import { tool } from "ai";
import { z } from "zod";
import type { PageManager } from "../browser/page.js";

export function createPressTool(pageManager: PageManager) {
  return tool({
    description:
      "Press a keyboard key on the current page (e.g. Enter, Escape, Tab, ArrowDown).",
    inputSchema: z.object({
      key: z
        .string()
        .describe("Key name, e.g. Enter / Escape / Tab / ArrowDown"),
    }),
    execute: async ({ key }) => {
      const page = await pageManager.getCurrent();
      await page.keyboard.press(key);
      return { ok: true };
    },
  });
}
