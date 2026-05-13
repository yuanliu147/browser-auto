import type { CDPPageManager } from "../cdp/page.js";

export async function wait(
  pageManager: CDPPageManager,
  selector: string | undefined,
  ms: number | undefined
): Promise<{ ok: true }> {
  if (selector) {
    const start = Date.now();
    const timeout = 10000;
    while (Date.now() - start < timeout) {
      const result = (await pageManager.send("Runtime.evaluate", {
        expression: `!!document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: true,
      })) as { result?: { value?: boolean } };
      if (result.result?.value) {
        return { ok: true };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
  }
  if (ms !== undefined) {
    await new Promise((r) => setTimeout(r, ms));
    return { ok: true };
  }
  throw new Error("Provide either selector or ms");
}
