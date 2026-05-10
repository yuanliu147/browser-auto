import type { Tool } from "../loop/types.js";
import type { CDPPageManager } from "../cdp/page.js";
import { createNavigateTool } from "./navigate.js";
import { createClickTool } from "./click.js";
import { createFillTool } from "./fill.js";
import { createWaitForTool } from "./wait.js";
import { createScreenshotTool } from "./screenshot.js";
import { createGetSnapshotTool } from "./snapshot.js";
import { createTabsTool } from "./tabs.js";
import { createSubmitDoneTool } from "./done.js";

export function createBrowserTools(
  pageManager: CDPPageManager
): Record<string, Tool> {
  return {
    navigate: createNavigateTool(pageManager),
    click: createClickTool(pageManager),
    fill: createFillTool(pageManager),
    waitFor: createWaitForTool(pageManager),
    screenshot: createScreenshotTool(pageManager),
    getSnapshot: createGetSnapshotTool(pageManager),
    tabs: createTabsTool(pageManager),
    submitDone: createSubmitDoneTool(),
  };
}
