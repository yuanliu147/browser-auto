import { writeFile } from "node:fs/promises";
import type { PageManager } from "../browser/page.js";
import type {
  TraceConfig,
  TraceData,
  TraceStep,
  TraceSummary,
  TraceToolCall,
} from "./types.js";
import {
  createTraceDir,
  generateLogText,
  isInteractionTool,
  takeScreenshot,
} from "./utils.js";

export class TraceRecorder {
  private pageManager: PageManager;
  private outputDir: string;
  private dir: string;
  private seq: number;
  private instruction: string;
  private startedAt: Date;
  private endedAt: Date | null = null;
  private steps: TraceStep[] = [];
  private toolCallMap: Map<string, TraceToolCall> = new Map();
  private totalUsage: TraceData["totalUsage"] = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  private finishReason: string = "";
  private success: boolean = true;

  constructor(
    pageManager: PageManager,
    config: TraceConfig,
    seq: number,
    instruction: string
  ) {
    this.pageManager = pageManager;
    this.outputDir = config.outputDir ?? "./traces";
    this.seq = seq;
    this.instruction = instruction;
    this.startedAt = new Date();
    this.dir = "";
  }

  async onStart(): Promise<void> {
    this.dir = await createTraceDir(this.outputDir, this.seq, this.instruction);
  }

  async onToolCallStart(
    callId: string,
    toolName: string,
    args: unknown
  ): Promise<void> {
    const toolCall: TraceToolCall = {
      callId,
      toolName,
      args,
      success: true,
      durationMs: 0,
    };

    if (isInteractionTool(toolName)) {
      const page = await this.pageManager.getCurrent();
      const screenshot = await takeScreenshot(
        page,
        this.dir,
        `call-${callId}-before.png`
      );
      toolCall.screenshotBefore = screenshot;
    }

    this.toolCallMap.set(callId, toolCall);
  }

  async onToolCallFinish(
    callId: string,
    success: boolean,
    output: unknown,
    error: string | undefined,
    durationMs: number
  ): Promise<void> {
    const toolCall = this.toolCallMap.get(callId);
    if (!toolCall) return;

    toolCall.success = success;
    toolCall.durationMs = durationMs;
    if (success) {
      toolCall.result = output;
    } else {
      toolCall.result = error;
      this.success = false;
    }

    if (isInteractionTool(toolCall.toolName)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const page = await this.pageManager.getCurrent();
      const screenshot = await takeScreenshot(
        page,
        this.dir,
        `call-${callId}-after.png`
      );
      toolCall.screenshotAfter = screenshot;
    }
  }

  onStepFinish(
    stepNumber: number,
    reasoningText: string | undefined,
    toolCalls: Array<{ id: string; name: string; arguments: unknown }>
  ): void {
    const step: TraceStep = {
      stepNumber,
      reasoningText,
      text: reasoningText,
      toolCalls: [],
    };

    for (const tc of toolCalls) {
      const recorded = this.toolCallMap.get(tc.id);
      if (recorded) {
        step.toolCalls.push(recorded);
      }
    }

    this.steps.push(step);
  }

  onFinish(
    finishReason: string,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  ): void {
    this.endedAt = new Date();
    this.finishReason = finishReason;
    this.totalUsage = {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
    };
    for (const step of this.steps) {
      for (const tc of step.toolCalls) {
        if (!tc.success) {
          this.success = false;
          break;
        }
      }
    }
  }

  getTraceData(): TraceData {
    const traceId = `${this.seq}-${this.startedAt.getTime()}`;
    return {
      traceId,
      instruction: this.instruction,
      startedAt: this.startedAt.toISOString(),
      endedAt: this.endedAt?.toISOString() ?? this.startedAt.toISOString(),
      durationMs: this.endedAt
        ? this.endedAt.getTime() - this.startedAt.getTime()
        : 0,
      success: this.success,
      finishReason: this.finishReason,
      totalUsage: this.totalUsage,
      outputDir: this.dir,
      steps: this.steps,
    };
  }

  getSummary(): TraceSummary {
    const data = this.getTraceData();
    return {
      traceId: data.traceId,
      instruction: data.instruction,
      startedAt: data.startedAt,
      endedAt: data.endedAt,
      durationMs: data.durationMs,
      success: data.success,
      finishReason: data.finishReason,
      totalUsage: data.totalUsage,
      outputDir: data.outputDir,
    };
  }

  async flush(): Promise<void> {
    const trace = this.getTraceData();
    await writeFile(`${this.dir}/trace.json`, JSON.stringify(trace, null, 2));
    await writeFile(`${this.dir}/log.txt`, generateLogText(trace));
  }
}
