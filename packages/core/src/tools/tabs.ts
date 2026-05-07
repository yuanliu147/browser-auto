import { tool } from "ai";
import { z } from "zod";
import type { PageManager } from "../browser/page.js";

export function createTabsTool(pageManager: PageManager) {
  return tool({
    description:
      "Manage browser tabs: list all, switch to one by index, or open a new one.",
    inputSchema: z.object({
      action: z.enum(["list", "switch", "new"]),
      url: z.string().optional().describe("URL to open (for action=new)"),
      index: z.number().optional().describe("Tab index (for action=switch)"),
    }),
    execute: async ({ action, url, index }) => {
      if (action === "list") {
        const pages = pageManager.list();
        const tabs = await Promise.all(
          pages.map(async (p, i) => ({
            index: i,
            url: p.url(),
            title: await p.title().catch(() => ""),
          }))
        );
        return { tabs };
      }
      if (action === "switch") {
        if (index === undefined) throw new Error("switch requires index");
        const p = await pageManager.switchByIndex(index);
        return { ok: true, url: p.url() };
      }
      if (action === "new") {
        const p = await pageManager.newPage(url);
        return { ok: true, url: p.url() };
      }
      throw new Error(`Unknown action: ${action as string}`);
    },
  });
}
