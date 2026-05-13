import type { CDPPageManager } from "../cdp/page.js";
import type { ElementLocator } from "../locator/types.js";
import { fillByBackendNodeId } from "../interaction/index.js";
import { resolveElement } from "./resolve.js";

export async function fill(
  pageManager: CDPPageManager,
  locator: ElementLocator | undefined,
  selector: string | undefined,
  value: string
): Promise<{ ok: true }> {
  const backendNodeId = await resolveElement(pageManager, locator, selector);
  if (!backendNodeId) {
    throw new Error(
      `Element not found: locator=${locator ? "present" : "none"}, selector=${selector ?? "none"}`
    );
  }
  await fillByBackendNodeId(pageManager, backendNodeId, value);
  return { ok: true };
}
