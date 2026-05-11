import type {
  LLMProvider,
  LoopResult,
  LoopStep,
  Message,
  Tool,
  ToolCallFinishEvent,
  ToolCallStartEvent,
  ToolDescription,
  ToolResult,
  StepFinishEvent,
  LoopFinishEvent,
  ToolContext,
} from "./types.js";

export class AgentLoop {
  model: LLMProvider;
  private maxSteps: number;

  constructor(model: LLMProvider, maxSteps: number) {
    this.model = model;
    this.maxSteps = maxSteps;
  }

  async run(
    instruction: string,
    tools: Record<string, Tool>,
    systemPrompt: string,
    options?: {
      initialMessages?: Message[];
      context?: ToolContext;
      onToolCallStart?: (e: ToolCallStartEvent) => void | Promise<void>;
      onToolCallFinish?: (e: ToolCallFinishEvent) => void | Promise<void>;
      onStepFinish?: (e: StepFinishEvent) => void;
      onFinish?: (e: LoopFinishEvent) => void;
    }
  ): Promise<LoopResult> {
    const toolDescriptions: ToolDescription[] = Object.entries(tools).map(
      ([name, tool]) => ({
        type: "function" as const,
        function: {
          name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })
    );

    const messages: Message[] = options?.initialMessages ?? [
      { role: "system", content: systemPrompt },
      { role: "user", content: instruction },
    ];

    const steps: LoopStep[] = [];
    const totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let finishReason = "max_steps";

    for (let stepNum = 1; stepNum <= this.maxSteps; stepNum++) {
      const response = await this.model.chat(messages, toolDescriptions);

      totalUsage.inputTokens += response.usage.inputTokens;
      totalUsage.outputTokens += response.usage.outputTokens;
      totalUsage.totalTokens += response.usage.totalTokens;

      const hasSubmitDone = response.toolCalls.some(
        (tc) => tc.name === "submitDone"
      );

      // Execute tool calls
      const toolResults: ToolResult[] = [];
      for (const tc of response.toolCalls) {
        if (options?.onToolCallStart) {
          await options.onToolCallStart({ toolCall: tc });
        }

        const startTime = Date.now();
        const tool = tools[tc.name];
        let result: unknown;
        let success = true;
        let error: string | undefined;

        if (!tool) {
          success = false;
          error = `Unknown tool: ${tc.name}`;
          result = { error };
        } else {
          try {
            result = await tool.execute(tc.arguments, options?.context ?? {});
          } catch (e) {
            success = false;
            error = e instanceof Error ? e.message : String(e);
            result = { error };
          }
        }

        const durationMs = Date.now() - startTime;
        const toolResult: ToolResult = {
          callId: tc.id,
          name: tc.name,
          output: result,
          success,
          error,
          durationMs,
        };
        toolResults.push(toolResult);

        if (options?.onToolCallFinish) {
          await options.onToolCallFinish({
            toolCall: tc,
            output: result,
            success,
            error,
            durationMs,
          });
        }
      }

      const step: LoopStep = {
        stepNumber: stepNum,
        reasoningText: response.content || undefined,
        text: response.content || undefined,
        toolCalls: response.toolCalls,
        toolResults,
      };
      steps.push(step);

      if (options?.onStepFinish) {
        options.onStepFinish({
          stepNumber: stepNum,
          reasoningText: response.content || undefined,
          text: response.content || undefined,
          toolCalls: response.toolCalls,
        });
      }

      // Build assistant message
      const assistantMsg: Message = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
        reasoningContent: response.reasoningContent,
      };
      messages.push(assistantMsg);

      // Build tool result messages
      for (const tr of toolResults) {
        messages.push({
          role: "tool",
          toolCallId: tr.callId,
          content: JSON.stringify(tr.output),
        });
      }

      if (hasSubmitDone || response.toolCalls.length === 0) {
        finishReason = hasSubmitDone ? "submit_done" : "no_tool_calls";
        break;
      }
    }

    if (options?.onFinish) {
      options.onFinish({ finishReason, totalUsage });
    }

    return {
      steps,
      success: finishReason === "submit_done",
      finishReason,
      totalUsage,
    };
  }
}
