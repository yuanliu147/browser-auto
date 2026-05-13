import type { CDPPageManager } from "../cdp/page.js";
import type { ElementLocator } from "../locator/types.js";
import { locateElement } from "../locator/find.js";
import { findBackendNodeIdBySelector } from "../interaction/index.js";

export async function resolveElement(
  pageManager: CDPPageManager,
  locator: ElementLocator | undefined,
  selector: string | undefined
): Promise<number | null> {
  if (locator && Object.keys(locator).length > 0) {
    try {
      const located = await locateElement(pageManager, locator);
      return located.backendNodeId;
    } catch {
      // 定位器解析失败，继续尝试选择器
    }
  }
  if (selector) {
    return findBackendNodeIdBySelector(pageManager, selector);
  }
  return null;
}
