export interface Tool {
  name: string;
  description: string;
  parameters: unknown; // z.ZodTypeAny
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  name: string;
  output: unknown;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface LoopStep {
  stepNumber: number;
  reasoningText?: string;
  text?: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
}

export interface LoopResult {
  steps: LoopStep[];
  success: boolean;
  finishReason: string;
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  reasoningContent?: string;
}

export interface ToolDescription {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

export interface LLMProvider {
  chat(messages: Message[], tools?: ToolDescription[]): Promise<LLMResponse>;
}

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  reasoningContent?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface ToolCallStartEvent {
  toolCall: ToolCall;
}

export interface ToolCallFinishEvent {
  toolCall: ToolCall;
  output: unknown;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface StepFinishEvent {
  stepNumber: number;
  reasoningText?: string;
  text?: string;
  toolCalls: ToolCall[];
}

export interface LoopFinishEvent {
  finishReason: string;
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}
