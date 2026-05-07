import type { ToolSet } from "ai";
import type { PageManager } from "../browser/page.js";
import { createNavigateTool } from "./navigate.js";
import { createClickTool } from "./click.js";
import { createFillTool } from "./fill.js";
import { createPressTool } from "./press.js";
import { createHoverTool } from "./hover.js";
import { createSelectTool } from "./select.js";
import { createWaitForTool } from "./wait.js";
import { createScreenshotTool } from "./screenshot.js";
import { createGetSnapshotTool } from "./snapshot.js";
import { createGetTextTool } from "./get-text.js";
import { createScrollTool } from "./scroll.js";
import { createTabsTool } from "./tabs.js";
import { createSubmitDoneTool } from "./done.js";

export function createBrowserTools(pageManager: PageManager): ToolSet {
  return {
    navigate: createNavigateTool(pageManager),
    click: createClickTool(pageManager),
    fill: createFillTool(pageManager),
    press: createPressTool(pageManager),
    hover: createHoverTool(pageManager),
    select: createSelectTool(pageManager),
    waitFor: createWaitForTool(pageManager),
    screenshot: createScreenshotTool(pageManager),
    getSnapshot: createGetSnapshotTool(pageManager),
    getText: createGetTextTool(pageManager),
    scroll: createScrollTool(pageManager),
    tabs: createTabsTool(pageManager),
    submitDone: createSubmitDoneTool(),
  };
}
