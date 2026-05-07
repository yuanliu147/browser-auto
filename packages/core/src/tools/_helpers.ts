import type { Locator, Page } from "playwright";

export function resolveLocator(
  page: Page,
  selector?: string,
  text?: string
): Locator {
  if (selector) return page.locator(selector);
  if (text) return page.getByText(text, { exact: false });
  throw new Error("Either selector or text must be provided");
}
