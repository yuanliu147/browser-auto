import { z } from "zod";
import type { CDPPageManager } from "../cdp/page.js";
import type { Tool } from "../loop/types.js";

export function createFillTool(pageManager: CDPPageManager): Tool {
  return {
    name: "fill",
    description: "Fill a text input or textarea with the given value.",
    parameters: z.object({
      selector: z.string().optional().describe("CSS selector of the input"),
      text: z
        .string()
        .optional()
        .describe("Visible label or placeholder of the input"),
      value: z.string().describe("Value to fill in"),
    }),
    execute: async ({ selector, text, value }) => {
      const expression = buildFillExpression(
        selector as string | undefined,
        text as string | undefined,
        value as string
      );
      const result = (await pageManager.evaluate(expression)) as {
        ok: boolean;
        error?: string;
      };
      if (!result?.ok) {
        throw new Error(result?.error ?? "Fill failed");
      }
      return { ok: true };
    },
  };
}

function buildFillExpression(
  selector: string | undefined,
  text: string | undefined,
  value: string
): string {
  const escapedValue = value.replace(/'/g, "\\'").replace(/\\/g, "\\\\");

  if (selector) {
    return `
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return { ok: false, error: 'Element not found: ${selector.replace(/'/g, "\\'")}' };
        el.value = '${escapedValue}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      })()
    `;
  }
  if (text) {
    return `
      (() => {
        const labels = Array.from(document.querySelectorAll('label'));
        const label = labels.find(l => l.textContent?.includes('${text.replace(/'/g, "\\'")}'));
        let el = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
        if (!el && label) el = label.nextElementSibling;
        if (!el) {
          const els = Array.from(document.querySelectorAll('input, textarea'));
          el = els.find(e => e.placeholder?.includes('${text.replace(/'/g, "\\'")}'));
        }
        if (!el) return { ok: false, error: 'Input not found by text: ${text.replace(/'/g, "\\'")}' };
        el.value = '${escapedValue}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      })()
    `;
  }
  return `(() => ({ ok: false, error: 'No selector or text provided' }))()`;
}
