import { chromium, type Browser, type BrowserContext } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserConfig } from "../types.js";

export interface BrowserHandles {
  browser: Browser;
  context: BrowserContext;
  ownsBrowser: boolean;
  ownsContext: boolean;
}

const CDP_PORT = 9223;

function getDefaultUserDataDir(): string {
  const dir = join(homedir(), ".browser-auto", "profile");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export async function createBrowserContext(
  config: BrowserConfig = {}
): Promise<BrowserHandles> {
  // 用户显式传入，直接复用
  if (config.browser) {
    const context = config.context ?? (await config.browser.newContext());
    return {
      browser: config.browser,
      context,
      ownsBrowser: false,
      ownsContext: !config.context,
    };
  }

  if (config.context) {
    const b = config.context.browser();
    if (!b) throw new Error("BrowserContext has no associated browser");
    return {
      browser: b,
      context: config.context,
      ownsBrowser: false,
      ownsContext: false,
    };
  }

  let browser: Browser;
  let context: BrowserContext;
  let ownsBrowser = false;

  // 1. 尝试复用上次没关的 Chrome（登录态还在）
  try {
    const b = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
    if (!b) throw new Error("connectOverCDP returned null");
    browser = b;
    context = browser.contexts()[0] ?? (await browser.newContext());
  } catch {
    // 2. 启动新的本地 Chrome，固定隔离用户目录
    context = await chromium.launchPersistentContext(getDefaultUserDataDir(), {
      headless: config.headless ?? false,
      channel: "chrome",
      args: [
        ...(config.args ?? []),
        `--remote-debugging-port=${CDP_PORT}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    const b = context.browser();
    if (!b) throw new Error("launchPersistentContext returned null browser");
    browser = b;
    ownsBrowser = true;
  }

  return { browser, context, ownsBrowser, ownsContext: false };
}

export async function closeBrowserContext(
  handles: BrowserHandles
): Promise<void> {
  if (handles.ownsBrowser) {
    await handles.browser.close();
  } else if (handles.ownsContext) {
    await handles.context.close();
  }
}
