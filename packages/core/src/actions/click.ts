import type { CDPPageManager } from "../cdp/page.js";
import type { ElementLocator } from "../locator/types.js";
import { clickByBackendNodeId } from "../interaction/index.js";
import { resolveElement } from "./resolve.js";

export async function click(
  pageManager: CDPPageManager,
  locator: ElementLocator | undefined,
  selector: string | undefined
): Promise<{ ok: true }> {
  const backendNodeId = await resolveElement(pageManager, locator, selector);
  if (!backendNodeId) {
    throw new Error(
      `Element not found: locator=${locator ? "present" : "none"}, selector=${selector ?? "none"}`
    );
  }
  await clickByBackendNodeId(pageManager, backendNodeId);
  return { ok: true };
}
