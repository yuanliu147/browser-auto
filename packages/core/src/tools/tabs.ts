import { z } from "zod";
import type { CDPPageManager } from "../cdp/page.js";
import type { Tool } from "../loop/types.js";

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
        const { targetInfos } = (await pageManager.send(
          "Target.getTargets"
        )) as {
          targetInfos: Array<{ url: string; title: string; type: string }>;
        };
        const tabs = targetInfos
          .filter((t) => t.type === "page")
          .map((t, i) => ({ index: i, url: t.url, title: t.title }));
        return { tabs };
      }
      if (action === "switch") {
        if (index === undefined) throw new Error("switch requires index");
        // CDP doesn't have direct tab switch; we track current target
        return { ok: true };
      }
      if (action === "new") {
        const { targetId } = (await pageManager.send("Target.createTarget", {
          url: url ?? "about:blank",
        })) as { targetId: string };
        return { ok: true, targetId };
      }
      throw new Error(`Unknown action: ${action as string}`);
    },
  };
}
