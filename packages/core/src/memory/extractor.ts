import type { TraceData } from "../logger/types.js";
import type { MemorizedPath, PathStep, SemanticHint } from "./types.js";
import { fingerprint } from "./types.js";

export const EXPLORATORY_TOOLS = ["getSnapshot", "screenshot", "getText"];
export const EXECUTION_TOOLS = [
  "navigate",
  "click",
  "fill",
  "press",
  "hover",
  "select",
  "scroll",
  "tabs",
];

export function extractMinimalPath(trace: TraceData): MemorizedPath | null {
  // Rule 1: last step must have successful submitDone
  const lastStep = trace.steps[trace.steps.length - 1];
  const hasSubmitDone = lastStep?.toolCalls.some(
    (tc) => tc.toolName === "submitDone" && tc.success
  );
  if (!hasSubmitDone) return null;

  // Rule 2: extract successful execution steps, skip failed and exploratory ones
  const steps: PathStep[] = [];
  for (const step of trace.steps) {
    for (const tc of step.toolCalls) {
      if (!tc.success) continue;
      if (EXPLORATORY_TOOLS.includes(tc.toolName)) continue;
      if (tc.toolName === "submitDone") continue;
      if (EXECUTION_TOOLS.includes(tc.toolName) || tc.toolName === "waitFor") {
        const args = (tc.args as Record<string, unknown>) ?? {};
        steps.push({
          tool: tc.toolName,
          args,
          selectorFallbacks: extractSelectorFallbacks(args),
          semanticHint: extractSemanticHint(tc.toolName, args),
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

function extractSelectorFallbacks(args: Record<string, unknown>): string[] {
  const selector = args.selector as string | undefined;
  if (!selector) return [];

  const fallbacks: string[] = [];

  // #id → [id="id"]
  const idMatch = selector.match(/^#([\w-]+)$/);
  if (idMatch) {
    fallbacks.push(`[id="${idMatch[1]}"]`);
  }

  return fallbacks;
}

function extractSemanticHint(
  tool: string,
  args: Record<string, unknown>
): SemanticHint | undefined {
  const hint: SemanticHint = {};

  const selector = args.selector as string | undefined;
  const text = args.text as string | undefined;

  if (text) {
    hint.nearText = text;
  }

  if (selector) {
    const ariaMatch = selector.match(/\[aria-label=["']?([^"'\]]+)["']?\]/i);
    if (ariaMatch) hint.ariaLabel = ariaMatch[1];

    const placeholderMatch = selector.match(
      /\[placeholder=["']?([^"'\]]+)["']?\]/i
    );
    if (placeholderMatch) hint.placeholder = placeholderMatch[1];

    const typeMatch = selector.match(
      /\[?type=["']?(password|email|text|search)["']?\]?/i
    );
    if (typeMatch) hint.inputType = typeMatch[1];
  }

  if (tool === "fill") hint.tagName = "input";
  if (tool === "select") hint.tagName = "select";
  if (tool === "click") hint.tagName = "button";

  return Object.keys(hint).length > 0 ? hint : undefined;
}
