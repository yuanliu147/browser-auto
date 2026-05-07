import { createDeepSeek } from "@ai-sdk/deepseek";
import type { LanguageModel } from "ai";
import type { LLMConfig } from "../types.js";

export function createDeepSeekModel(config: LLMConfig = {}): LanguageModel {
  const apiKey = config.apiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "DeepSeek API key is required: pass via llm.apiKey or set DEEPSEEK_API_KEY env var"
    );
  }
  const provider = createDeepSeek({
    apiKey,
    baseURL: config.baseURL,
  });
  return provider(config.model ?? "deepseek-v4-flash");
}
