import { z } from "zod";
import type { CDPPageManager } from "../cdp/page.js";
import type { Tool } from "../loop/types.js";
import { listTabs, switchTab, newTab } from "../actions/tabs.js";

export function createTabsTool(pageManager: CDPPageManager): Tool {
  return {
    name: "tabs",
    description:
      "Manage browser tabs: list all, switch to one by index, or open a new one.",
    parameters: z.object({
      action: z.enum(["list", "switch", "new"]),
      url: z.string().optional().describe("URL to open (for action=new)"),
      index: z.number().optional().describe("Tab index (for action=switch)"),
    }),
    execute: async ({ action, url, index }, _context) => {
      if (action === "list") {
        const tabs = await listTabs(pageManager);
        return { tabs };
      }
      if (action === "switch") {
        if (index === undefined) throw new Error("switch requires index");
        await switchTab(pageManager, index as number);
        return { ok: true };
      }
      if (action === "new") {
        const result = await newTab(pageManager, url as string | undefined);
        return result;
      }
      throw new Error(`Unknown action: ${action as string}`);
    },
  };
}
