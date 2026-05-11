export interface TraceConfig {
  outputDir?: string;
}

export interface TraceScreenshotInfo {
  path: string | null;
  error?: string;
}

export interface TraceToolCall {
  callId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  success: boolean;
  durationMs: number;
  screenshotBefore?: TraceScreenshotInfo;
  screenshotAfter?: TraceScreenshotInfo;
}

export interface TraceStep {
  stepNumber: number;
  reasoningText?: string;
  text?: string;
  toolCalls: TraceToolCall[];
  refMap?: Record<string, unknown>;
}

export interface TraceSummary {
  traceId: string;
  instruction: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  success: boolean;
  finishReason: string;
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  outputDir: string;
}

export interface TraceData extends TraceSummary {
  steps: TraceStep[];
}
