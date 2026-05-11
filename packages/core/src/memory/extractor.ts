import type { TraceData } from "../logger/types.js";
import type { ElementLocator, MemorizedPath, PathStep } from "./types.js";
import { fingerprint } from "./types.js";

export const EXPLORATORY_TOOLS = ["getSnapshot", "screenshot", "getText"];
export const EXECUTION_TOOLS = ["navigate", "click", "fill", "waitFor", "tabs"];

export function extractMinimalPath(trace: TraceData): MemorizedPath | null {
  // Rule 1: last step must have successful submitDone
  const lastStep = trace.steps[trace.steps.length - 1];
  const hasSubmitDone = lastStep?.toolCalls.some(
    (tc) => tc.toolName === "submitDone" && tc.success
  );
  if (!hasSubmitDone) return null;

  // Rule 2: extract successful execution steps, skip failed and exploratory ones
  const steps: PathStep[] = [];
  let currentRefMap: Map<string, ElementLocator> | undefined;
  for (const step of trace.steps) {
    // Update refMap from snapshot steps
    if (step.refMap) {
      currentRefMap = new Map();
      for (const [k, v] of Object.entries(step.refMap)) {
        currentRefMap.set(k, v as ElementLocator);
      }
    }

    for (const tc of step.toolCalls) {
      if (!tc.success) continue;
      if (EXPLORATORY_TOOLS.includes(tc.toolName)) continue;
      if (tc.toolName === "submitDone") continue;
      if (EXECUTION_TOOLS.includes(tc.toolName) || tc.toolName === "waitFor") {
        const args = (tc.args as Record<string, unknown>) ?? {};
        steps.push({
          tool: tc.toolName,
          args,
          locator: extractLocator(args, currentRefMap),
        });
      }
    }
  }

  return {
    fingerprint: fingerprint(trace.instruction),
    createdAt: new Date().toISOString(),
    hitCount: 0,
    steps,
  };
}

function extractLocator(
  args: Record<string, unknown>,
  refMap?: Map<string, ElementLocator>
): PathStep["locator"] {
  const locator: PathStep["locator"] = {};

  // 1. Try ref (preferred)
  const ref = args.ref as string | undefined;
  if (ref) {
    const key = ref.startsWith("@") ? ref.slice(1) : ref;
    const refLocator = refMap?.get(key);
    if (refLocator) {
      return refLocator;
    }
  }

  // 2. Try selector
  const selector = args.selector as string | undefined;
  if (selector) {
    // Try to extract semantic hints from selector
    const ariaMatch = selector.match(/\[aria-label=["']?([^"'\]]+)["']?\]/i);
    if (ariaMatch) {
      locator.semantic = { ...locator.semantic, ariaLabel: ariaMatch[1] };
    }

    const placeholderMatch = selector.match(
      /\[placeholder=["']?([^"'\]]+)["']?\]/i
    );
    if (placeholderMatch) {
      locator.semantic = {
        ...locator.semantic,
        placeholder: placeholderMatch[1],
      };
    }

    // Fallback to xpath if selector is complex
    if (!locator.semantic) {
      locator.xpath = selector;
    }
  }

  return Object.keys(locator).length > 0 ? locator : undefined;
}
