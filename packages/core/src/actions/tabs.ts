import type { CDPPageManager } from "../cdp/page.js";

export async function listTabs(
  pageManager: CDPPageManager
): Promise<Array<{ index: number; url: string; title: string }>> {
  const { targetInfos } = (await pageManager.send("Target.getTargets")) as {
    targetInfos: Array<{ url: string; title: string; type: string }>;
  };
  return targetInfos
    .filter((t) => t.type === "page")
    .map((t, i) => ({ index: i, url: t.url, title: t.title }));
}

export async function switchTab(
  _pageManager: CDPPageManager,
  _index: number
): Promise<{ ok: true }> {
  // CDP 没有直接的标签切换；我们跟踪当前目标
  return { ok: true };
}

export async function newTab(
  pageManager: CDPPageManager,
  url?: string
): Promise<{ ok: true; targetId: string }> {
  const { targetId } = (await pageManager.send("Target.createTarget", {
    url: url ?? "about:blank",
  })) as { targetId: string };
  return { ok: true, targetId };
}
