import type { CDPPageManager } from "../cdp/page.js";
import type { ContextPath, ContextStep, FrameMatcher } from "./types.js";

export interface ExecutionContext {
  page: CDPPageManager;
  frameId?: string;
  shadowHost?: string;
}

export async function enterContextPath(
  page: CDPPageManager,
  path: ContextPath
): Promise<ExecutionContext> {
  let context: ExecutionContext = { page };

  for (const step of path) {
    context = await enterStep(context, step);
  }

  return context;
}

async function enterStep(
  ctx: ExecutionContext,
  step: ContextStep
): Promise<ExecutionContext> {
  switch (step.type) {
    case "frame":
      return enterFrame(ctx, step.matcher);
    case "shadow":
      return enterShadow(ctx, step.matcher.hostSelector);
    case "modal":
      return ctx; // Modal is part of main DOM, no context switch needed
    default:
      return ctx;
  }
}

async function enterFrame(
  ctx: ExecutionContext,
  matcher: FrameMatcher
): Promise<ExecutionContext> {
  const { frameTree } = (await ctx.page.send("Page.getFrameTree")) as {
    frameTree: {
      frame: { id: string; url: string; name?: string };
      childFrames?: Array<{
        frame: { id: string; url: string; name?: string };
        childFrames?: unknown[];
      }>;
    };
  };

  const allFrames = flattenFrameTree(frameTree);
  const matched = allFrames.find((f) => matchFrame(f, matcher));

  if (!matched) {
    throw new Error(`Frame not found: ${JSON.stringify(matcher)}`);
  }

  return { ...ctx, frameId: matched.id };
}

function flattenFrameTree(tree: {
  frame: { id: string; url: string; name?: string };
  childFrames?: Array<{
    frame: { id: string; url: string; name?: string };
    childFrames?: unknown[];
  }>;
}): Array<{ id: string; url: string; name?: string }> {
  const result = [tree.frame];
  for (const child of tree.childFrames ?? []) {
    result.push(
      ...flattenFrameTree(
        child as {
          frame: { id: string; url: string; name?: string };
          childFrames?: Array<{
            frame: { id: string; url: string; name?: string };
            childFrames?: unknown[];
          }>;
        }
      )
    );
  }
  return result;
}

function matchFrame(
  frame: { id: string; url: string; name?: string },
  matcher: FrameMatcher
): boolean {
  switch (matcher.strategy) {
    case "url-pattern":
      return matcher.pattern
        ? new RegExp(matcher.pattern).test(frame.url)
        : false;
    case "name":
      return frame.name === matcher.name;
    case "index":
      return false; // Index matching requires ordered traversal, handled separately
    default:
      return false;
  }
}

async function enterShadow(
  ctx: ExecutionContext,
  hostSelector: string
): Promise<ExecutionContext> {
  return { ...ctx, shadowHost: hostSelector };
}
