import type { CDPPageManager } from "../cdp/page.js";

export async function navigate(
  pageManager: CDPPageManager,
  url: string
): Promise<{ ok: true; url: string }> {
  await pageManager.send("Page.navigate", { url });
  const { frameTree } = (await pageManager.send("Page.getFrameTree")) as {
    frameTree: { frame: { url: string } };
  };
  return { ok: true, url: frameTree.frame.url };
}
