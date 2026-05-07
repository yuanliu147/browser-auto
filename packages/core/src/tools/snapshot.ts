import { tool } from "ai";
import { z } from "zod";
import type { PageManager } from "../browser/page.js";

// interface SimplifiedNode {
//   role?: string;
//   name?: string;
//   value?: string | number;
//   children?: SimplifiedNode[];
// }

// interface RawA11yNode {
//   role?: string;
//   name?: string;
//   value?: string | number;
//   children?: RawA11yNode[];
// }

// function simplify(node: RawA11yNode | null): SimplifiedNode | null {
//   if (!node) return null;
//   const out: SimplifiedNode = {};
//   if (node.role) out.role = node.role;
//   if (node.name) out.name = node.name;
//   if (node.value !== undefined) out.value = node.value;
//   if (node.children?.length) {
//     const kids = node.children.map(simplify).filter((x): x is SimplifiedNode => x !== null);
//     if (kids.length) out.children = kids;
//   }
//   return out;
// }

export function createGetSnapshotTool(pageManager: PageManager) {
  return tool({
    description:
      "Get a structured accessibility snapshot of the current page. Use this to understand the page layout before clicking/filling.",
    inputSchema: z.object({}),
    execute: async () => {
      const page = await pageManager.getCurrent();
      const snap = await page.locator("body").ariaSnapshot();
      return { snapshot: snap };
    },
  });
}
