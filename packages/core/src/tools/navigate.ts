import { z } from "zod";
import type { CDPPageManager } from "../cdp/page.js";
import type { Tool } from "../loop/types.js";

export function createNavigateTool(pageManager: CDPPageManager): Tool {
  return {
    name: "navigate",
    description: "Navigate to a URL in the current page.",
    parameters: z.object({
      url: z.string().describe("The URL to navigate to"),
    }),
    execute: async ({ url }, context) => {
      await pageManager.navigate(url as string);
      // 页面跳转后，旧的 refMap 失效，需要清除
      if (context) {
        context.refMap = undefined;
      }
      const { frameTree } = (await pageManager.send("Page.getFrameTree")) as {
        frameTree: { frame: { url: string } };
      };
      return { ok: true, url: frameTree.frame.url };
    },
  };
}
