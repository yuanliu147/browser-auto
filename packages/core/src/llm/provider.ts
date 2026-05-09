import type { LLMConfig } from "../types.js";
import type {
  LLMProvider,
  LLMResponse,
  Message,
  ToolCall,
  ToolDescription,
} from "../loop/types.js";

interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class DeepSeekProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor(config: LLMConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "";
    if (!this.apiKey) {
      throw new Error(
        "DeepSeek API key is required: pass via llm.apiKey or set DEEPSEEK_API_KEY env var"
      );
    }
    this.model = config.model ?? "deepseek-v4-flash";
    this.baseURL = config.baseURL ?? "https://api.deepseek.com";
  }

  async chat(
    messages: Message[],
    tools?: ToolDescription[]
  ): Promise<LLMResponse> {
    const body = {
      model: this.model,
      messages: messages.map((m) => this.toApiMessage(m)),
      ...(tools && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    };

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`DeepSeek API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as DeepSeekResponse;
    const choice = data.choices[0];
    if (!choice) throw new Error("No choices in LLM response");

    const toolCalls: ToolCall[] =
      choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: this.safeJsonParse(tc.function.arguments),
      })) ?? [];

    return {
      content: choice.message.content ?? "",
      toolCalls,
      reasoningContent: choice.message.reasoning_content,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }

  private toApiMessage(m: Message): {
    role: string;
    content: string;
    reasoning_content?: string;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  } {
    const base: {
      role: string;
      content: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
      tool_call_id?: string;
    } = {
      role: m.role,
      content: m.content ?? "",
    };

    if (m.reasoningContent) {
      base.reasoning_content = m.reasoningContent;
    }

    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      base.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }

    if (m.role === "tool") {
      base.tool_call_id = m.toolCallId ?? "";
    }

    return base;
  }

  private safeJsonParse(str: string): Record<string, unknown> {
    try {
      return JSON.parse(str) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

export function createDeepSeekProvider(config: LLMConfig = {}): LLMProvider {
  return new DeepSeekProvider(config);
}
