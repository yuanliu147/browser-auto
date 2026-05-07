import { generateText, stepCountIs, hasToolCall } from "ai";
import type { LanguageModel } from "ai";
import {
  createBrowserContext,
  closeBrowserContext,
  type BrowserHandles,
} from "./browser/index.js";
import { PageManager } from "./browser/page.js";
import { createDeepSeekModel } from "./llm/index.js";
import { createBrowserTools } from "./tools/index.js";
import { TraceRecorder } from "./logger/index.js";
import type { ActOptions, AgentOptions } from "./types.js";
import type { TraceConfig } from "./logger/types.js";

const ACT_SYSTEM_PROMPT = `You are a browser automation agent. You drive a real Chromium browser via tools.

Available tools:
- navigate(url)            : open a URL in the current tab
- click(selector|text)     : click an element by CSS selector or visible text
- fill(selector|text,value): fill a text input
- press(key)               : press a keyboard key (Enter, Escape, Tab, ...)
- hover(selector|text)     : hover an element
- select(selector|text,value): pick an option in <select>
- waitFor(selector|ms,state): wait for an element or a fixed duration
- screenshot()             : take a screenshot of the current tab
- getSnapshot()            : get a structured a11y tree of the current page (use this when you don't know the page layout)
- getText(selector|text)   : read the text content of an element
- scroll(direction,amount) : scroll the current page
- tabs(action,...)         : list/switch/new tabs (the "current tab" auto-switches when a new one opens)
- submitDone(result?)      : MUST be called exactly once at the end to mark the task as complete

Rules:
1. Think about the goal, then act with the smallest sequence of tool calls.
2. Prefer concrete CSS selectors when you have them; fall back to visible text otherwise.
3. If you don't know the page layout, call getSnapshot() first.
4. When a new tab opens, the "current page" auto-switches — keep working on the active tab.
5. When the task is complete, call submitDone() once. Do NOT keep calling tools after that.
6. If a tool errors, read the error and adjust — do not retry the exact same call blindly.`;

function applyVariables(
  instruction: string,
  variables?: Record<string, string>
): string {
  if (!variables) return instruction;
  return instruction.replace(/\$\{(\w+)\}/g, (match, name: string) => {
    return name in variables ? variables[name]! : match;
  });
}

export class BrowserAgent {
  private handles: BrowserHandles;
  private pageManager: PageManager;
  private model: LanguageModel;
  private maxSteps: number;
  private traceConfig?: TraceConfig;
  private traceSeq: number = 0;

  private constructor(
    handles: BrowserHandles,
    pageManager: PageManager,
    model: LanguageModel,
    maxSteps: number,
    traceConfig?: TraceConfig
  ) {
    this.handles = handles;
    this.pageManager = pageManager;
    this.model = model;
    this.maxSteps = maxSteps;
    this.traceConfig = traceConfig;
  }

  static async create(options: AgentOptions = {}): Promise<BrowserAgent> {
    const handles = await createBrowserContext(options.browser);
    const pageManager = new PageManager(handles.context);
    const model = createDeepSeekModel(options.llm);
    return new BrowserAgent(
      handles,
      pageManager,
      model,
      options.maxSteps ?? 50,
      options.trace
    );
  }

  async act(instruction: string, opts: ActOptions = {}): Promise<void> {
    const prompt = applyVariables(instruction, opts.variables);
    const tools = createBrowserTools(this.pageManager);
    const maxSteps = opts.maxSteps ?? this.maxSteps;

    let recorder: TraceRecorder | undefined;
    if (this.traceConfig) {
      this.traceSeq++;
      recorder = new TraceRecorder(
        this.pageManager,
        this.traceConfig,
        this.traceSeq,
        instruction
      );
      await recorder.onStart();
    }

    try {
      await generateText({
        model: this.model,
        tools,
        system: ACT_SYSTEM_PROMPT,
        prompt,
        stopWhen: [stepCountIs(maxSteps), hasToolCall("submitDone")],
        ...(recorder
          ? {
              experimental_onToolCallStart: (e) => recorder!.onToolCallStart(e),
              experimental_onToolCallFinish: (e) =>
                recorder!.onToolCallFinish(e),
              onStepFinish: (e) => recorder!.onStepFinish(e),
              onFinish: (e) => recorder!.onFinish(e),
            }
          : {}),
      });
    } finally {
      if (recorder) {
        await recorder.flush();
      }
    }
  }

  async close(): Promise<void> {
    await closeBrowserContext(this.handles);
  }
}

export async function createBrowserAgent(
  options: AgentOptions = {}
): Promise<BrowserAgent> {
  return BrowserAgent.create(options);
}
