import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import type { Tool } from "../loop/types.js";

export function createPressTool(pageManager: PageManager): Tool {
  return {
    name: "press",
    description:
      "Press a keyboard key on the current page (e.g. Enter, Escape, Tab, ArrowDown).",
    parameters: z.object({
      key: z
        .string()
        .describe("Key name, e.g. Enter / Escape / Tab / ArrowDown"),
    }),
    execute: async ({ key }) => {
      const page = await pageManager.getCurrent();
      await page.keyboard.press(key as string);
      return { ok: true };
    },
  };
}
