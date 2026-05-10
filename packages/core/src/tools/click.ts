import { z } from "zod";
import type { CDPPageManager } from "../cdp/page.js";
import type { Tool } from "../loop/types.js";

export function createClickTool(pageManager: CDPPageManager): Tool {
  return {
    name: "click",
    description:
      "Click an element. Provide either selector (CSS) or text (visible text of the element).",
    parameters: z.object({
      selector: z.string().optional().describe("CSS selector"),
      text: z.string().optional().describe("Visible text of the element"),
    }),
    execute: async ({ selector, text }) => {
      const expression = buildClickExpression(
        selector as string | undefined,
        text as string | undefined
      );
      const result = (await pageManager.evaluate(expression)) as {
        ok: boolean;
        error?: string;
      };
      if (!result?.ok) {
        throw new Error(result?.error ?? "Click failed");
      }
      return { ok: true };
    },
  };
}

function buildClickExpression(
  selector: string | undefined,
  text: string | undefined
): string {
  if (selector) {
    return `
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return { ok: false, error: 'Element not found: ${selector.replace(/'/g, "\\'")}' };
        el.click();
        return { ok: true };
      })()
    `;
  }
  if (text) {
    return `
      (() => {
        const els = Array.from(document.querySelectorAll('*'));
        const el = els.find(e => e.textContent?.includes('${text.replace(/'/g, "\\'")}'));
        if (!el) return { ok: false, error: 'Element not found by text: ${text.replace(/'/g, "\\'")}' };
        el.click();
        return { ok: true };
      })()
    `;
  }
  return `(() => ({ ok: false, error: 'No selector or text provided' }))()`;
}
