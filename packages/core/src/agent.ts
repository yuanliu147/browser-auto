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
import type { TraceConfig, TraceData, TraceSummary } from "./logger/types.js";
import { AgentLoop } from "./loop/loop.js";
import type { Message, Tool, ToolContext } from "./loop/types.js";
import { InMemoryPathMemory, ExactMemoryKey } from "./memory/types.js";
import { extractMinimalPath } from "./memory/extractor.js";
import { replayPath } from "./memory/replayer.js";
import type { MemorizedPath } from "./memory/types.js";
import { ACT_SYSTEM_PROMPT } from "./prompts/system.js";
import { buildHandoverMessages } from "./prompts/handover.js";
import { getAXTree, collectDOMInfo } from "./snapshot/axtree.js";
import { serializeSnapshot } from "./snapshot/serializer.js";

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

  async act(
    instruction: string,
    opts: ActOptions = {}
  ): Promise<TraceSummary | undefined> {
    const prompt = applyVariables(instruction, opts.variables);
    const tools = createBrowserTools(this.pageManager);
    const maxSteps = opts.maxSteps ?? 50;

    // 1. Check memory
    const memoryKey = new ExactMemoryKey(prompt);
    const memorizedPath = this.memory.get(memoryKey);

    if (memorizedPath) {
      console.log("----命中缓存----");
      const replayResult = await replayPath(memorizedPath, this.pageManager);

      if (replayResult.status === "success") {
        memorizedPath.hitCount++;
        return undefined;
      }

      if (
        replayResult.status === "failed" &&
        replayResult.reason === "structural"
      ) {
        this.memory.invalidate(memoryKey);
      }

      if (replayResult.status === "partial" && replayResult.remainingSteps) {
        // Handover to LLM from breakpoint
        const result = await this.runWithHandover(
          prompt,
          tools,
          maxSteps,
          memorizedPath,
          replayResult.completedSteps ?? [],
          replayResult.remainingSteps,
          replayResult.failedAt ?? replayResult.completedSteps?.length ?? 0,
          replayResult.reason
        );
        return result;
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
      return {
        traceId: result.traceData.traceId,
        instruction: result.traceData.instruction,
        startedAt: result.traceData.startedAt,
        endedAt: result.traceData.endedAt,
        durationMs: result.traceData.durationMs,
        success: result.traceData.success,
        finishReason: result.traceData.finishReason,
        totalUsage: result.traceData.totalUsage,
        outputDir: result.traceData.outputDir,
      };
    }

    return undefined;
  }

  private async runLoop(
    prompt: string,
    tools: Record<string, Tool>,
    maxSteps: number,
    options?: {
      initialMessages?: Message[];
      initialRefMap?: Map<string, import("./memory/types.js").ElementLocator>;
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
    const context: ToolContext = {
      pageManager: this.pageManager,
      refMap: options?.initialRefMap,
    };

    try {
      const result = await loop.run(prompt, tools, ACT_SYSTEM_PROMPT, {
        context,
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
            if (
              e.toolCall.name === "getSnapshot" &&
              e.success &&
              context.refMap
            ) {
              recorder.onRefMap(context.refMap as Map<string, unknown>);
            }
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
    tools: Record<string, Tool>,
    maxSteps: number,
    memorizedPath: MemorizedPath,
    completedStepIndices: number[],
    remainingSteps: Array<{ tool: string; args: Record<string, unknown> }>,
    failedAt: number,
    failedReason?: string
  ): Promise<TraceSummary | undefined> {
    const failedStep = remainingSteps[0];

    let snapshot = "";
    let refMap:
      | Map<string, import("./memory/types.js").ElementLocator>
      | undefined;
    try {
      const tree = await getAXTree(this.pageManager);
      const domMap = await collectDOMInfo(this.pageManager, tree.nodes);
      const output = serializeSnapshot(tree, domMap);
      snapshot = output.text;
      refMap = output.refMap;
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

    const result = await this.runLoop(prompt, tools, maxSteps, {
      initialMessages,
      initialRefMap: refMap,
    });

    if (result.traceData) {
      return {
        traceId: result.traceData.traceId,
        instruction: result.traceData.instruction,
        startedAt: result.traceData.startedAt,
        endedAt: result.traceData.endedAt,
        durationMs: result.traceData.durationMs,
        success: result.traceData.success,
        finishReason: result.traceData.finishReason,
        totalUsage: result.traceData.totalUsage,
        outputDir: result.traceData.outputDir,
      };
    }
    return undefined;
  }

  async getPageState(): Promise<{ url: string; title: string }> {
    const [url, title] = await Promise.all([
      this.pageManager
        .send("Runtime.evaluate", {
          expression: "window.location.href",
          returnByValue: true,
        })
        .then((r) => (r as { result?: { value?: unknown } }).result?.value),
      this.pageManager
        .send("Runtime.evaluate", {
          expression: "document.title",
          returnByValue: true,
        })
        .then((r) => (r as { result?: { value?: unknown } }).result?.value),
    ]);
    return { url: String(url ?? ""), title: String(title ?? "") };
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
