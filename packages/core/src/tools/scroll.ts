import { z } from "zod";
import type { PageManager } from "../browser/page.js";
import type { Tool } from "../loop/types.js";

export function createScrollTool(pageManager: PageManager): Tool {
  return {
    name: "scroll",
    description: "Scroll the current page up or down.",
    parameters: z.object({
      direction: z.enum(["up", "down"]),
      amount: z
        .number()
        .optional()
        .describe("Pixels to scroll (defaults to 500)"),
    }),
    execute: async ({ direction, amount }) => {
      const page = await pageManager.getCurrent();
      const px = (amount as number) ?? 500;
      const dy = direction === "down" ? px : -px;
      await page.evaluate((d) => window.scrollBy(0, d), dy);
      return { ok: true };
    },
  };
}
