import { z } from "zod";
import type { CDPPageManager } from "../cdp/page.js";
import type { Tool } from "../loop/types.js";
import { getAXTree } from "../snapshot/axtree.js";
import { serializeSnapshot } from "../snapshot/serializer.js";

export function createGetSnapshotTool(pageManager: CDPPageManager): Tool {
  return {
    name: "getSnapshot",
    description:
      "Get a structured accessibility snapshot of the current page. Use this when you don't know the page layout.",
    parameters: z.object({
      scope: z
        .string()
        .optional()
        .describe("Optional CSS selector to limit snapshot scope"),
    }),
    execute: async (_args, context) => {
      const tree = await getAXTree(pageManager);
      const output = serializeSnapshot(tree);
      if (context) {
        context.refMap = output.refMap;
      }
      return { snapshot: output.text };
    },
  };
}
