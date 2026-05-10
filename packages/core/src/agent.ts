import {
  createBrowserConnection,
  closeBrowser,
  type BrowserHandles,
} from "./cdp/browser.js";
import { CDPPageManager } from "./cdp/page.js";
import { createDeepSeekProvider } from "./llm/provider.js";
import { createBrowserTools } from "./tools/index.js";
import { TraceRecorder } from "./logger/index.js";
import type { ActOptions, AgentOptions } from "./types.js";
import type { TraceConfig, TraceData } from "./logger/types.js";
import { AgentLoop } from "./loop/loop.js";
import type { Message } from "./loop/types.js";
import { InMemoryPathMemory, ExactMemoryKey } from "./memory/types.js";
import { extractMinimalPath } from "./memory/extractor.js";
import { replayPath } from "./memory/replayer.js";
import type { MemorizedPath } from "./memory/types.js";
import { ACT_SYSTEM_PROMPT } from "./prompts/system.js";
import { buildHandoverMessages } from "./prompts/handover.js";

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
  private pageManager: CDPPageManager;
  private loop: AgentLoop;
  private traceConfig?: TraceConfig;
  private traceSeq: number = 0;
  private memory: InMemoryPathMemory;

  private constructor(
    handles: BrowserHandles,
    pageManager: CDPPageManager,
    loop: AgentLoop,
    traceConfig?: TraceConfig
  ) {
    this.handles = handles;
    this.pageManager = pageManager;
    this.loop = loop;
    this.traceConfig = traceConfig;
    this.memory = new InMemoryPathMemory();
  }

  static async create(options: AgentOptions = {}): Promise<BrowserAgent> {
    const handles = await createBrowserConnection();
    const pageManager = new CDPPageManager(handles.client);
    await pageManager.init();
    const provider = createDeepSeekProvider(options.llm);
    const loop = new AgentLoop(provider, options.maxSteps ?? 50);
    return new BrowserAgent(handles, pageManager, loop, options.trace);
  }

  async act(instruction: string, opts: ActOptions = {}): Promise<void> {
    const prompt = applyVariables(instruction, opts.variables);
    const tools = createBrowserTools(this.pageManager);
    const maxSteps = opts.maxSteps ?? 50;

    // 1. Check memory
    const memoryKey = new ExactMemoryKey(prompt);
    const memorizedPath = this.memory.get(memoryKey);

    if (memorizedPath) {
      const replayResult = await replayPath(memorizedPath, this.pageManager);

      if (replayResult.status === "success") {
        memorizedPath.hitCount++;
        return;
      }

      if (
        replayResult.status === "failed" &&
        replayResult.reason === "structural"
      ) {
        this.memory.invalidate(memoryKey);
      }

      if (replayResult.status === "partial" && replayResult.remainingSteps) {
        // Handover to LLM from breakpoint
        return await this.runWithHandover(
          prompt,
          tools,
          maxSteps,
          memorizedPath,
          replayResult.completedSteps ?? [],
          replayResult.remainingSteps,
          replayResult.failedAt ?? replayResult.completedSteps?.length ?? 0,
          replayResult.reason
        );
      }
    }

    // 2. Run LLM loop
    const result = await this.runLoop(prompt, tools, maxSteps);

    // 3. Extract and memorize on success
    if (result.success && result.traceData) {
      const path = extractMinimalPath(result.traceData);
      if (path) {
        this.memory.set(memoryKey, path);
      }
    }
  }

  private async runLoop(
    prompt: string,
    tools: Record<
      string,
      {
        name: string;
        description: string;
        parameters: unknown;
        execute: (args: Record<string, unknown>) => Promise<unknown>;
      }
    >,
    maxSteps: number,
    options?: {
      initialMessages?: Message[];
    }
  ): Promise<{ success: boolean; traceData?: TraceData }> {
    let recorder: TraceRecorder | undefined;
    if (this.traceConfig) {
      this.traceSeq++;
      recorder = new TraceRecorder(
        this.pageManager,
        this.traceConfig,
        this.traceSeq,
        prompt
      );
      await recorder.onStart();
    }

    const loop = new AgentLoop(this.loop.model, maxSteps);

    try {
      const result = await loop.run(prompt, tools, ACT_SYSTEM_PROMPT, {
        initialMessages: options?.initialMessages,
        onToolCallStart: async (e) => {
          if (recorder) {
            await recorder.onToolCallStart(
              e.toolCall.id,
              e.toolCall.name,
              e.toolCall.arguments
            );
          }
        },
        onToolCallFinish: async (e) => {
          if (recorder) {
            await recorder.onToolCallFinish(
              e.toolCall.id,
              e.success,
              e.output,
              e.error,
              e.durationMs
            );
          }
        },
        onStepFinish: (e) => {
          if (recorder) {
            recorder.onStepFinish(
              e.stepNumber,
              e.reasoningText,
              e.toolCalls.map((tc) => ({
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
              }))
            );
          }
        },
        onFinish: (e) => {
          if (recorder) {
            recorder.onFinish(e.finishReason, e.totalUsage);
          }
        },
      });

      const traceData = recorder?.getTraceData();
      return { success: result.success, traceData };
    } finally {
      if (recorder) {
        await recorder.flush();
      }
    }
  }

  private async runWithHandover(
    prompt: string,
    tools: Record<
      string,
      {
        name: string;
        description: string;
        parameters: unknown;
        execute: (args: Record<string, unknown>) => Promise<unknown>;
      }
    >,
    maxSteps: number,
    memorizedPath: MemorizedPath,
    completedStepIndices: number[],
    remainingSteps: Array<{ tool: string; args: Record<string, unknown> }>,
    failedAt: number,
    failedReason?: string
  ): Promise<void> {
    const failedStep = remainingSteps[0];

    let snapshot = "";
    try {
      const result = await this.pageManager.evaluate(`
        document.body?.innerText?.slice(0, 2000) || 'Unable to get page text'
      `);
      snapshot = String(result ?? "");
    } catch {
      snapshot = "Unable to get page snapshot";
    }

    const selector = failedStep.args.selector as string | undefined;
    const errorMsg =
      failedReason ??
      (selector ? `选择器 "${selector}" 未找到` : "元素定位失败");

    const initialMessages = buildHandoverMessages(
      prompt,
      memorizedPath,
      completedStepIndices,
      failedAt,
      errorMsg,
      snapshot
    );

    await this.runLoop(prompt, tools, maxSteps, { initialMessages });
  }

  async close(): Promise<void> {
    await closeBrowser(this.handles);
  }
}

export async function createBrowserAgent(
  options: AgentOptions = {}
): Promise<BrowserAgent> {
  return BrowserAgent.create(options);
}
