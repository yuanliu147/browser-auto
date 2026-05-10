import type { TraceConfig } from "./logger/types.js";

export interface BrowserConfig {
  headless?: boolean;
  channel?: string;
  args?: string[];
}

export interface LLMConfig {
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

export interface AgentOptions {
  browser?: BrowserConfig;
  llm?: LLMConfig;
  maxSteps?: number;
  trace?: TraceConfig;
}

export interface ActOptions {
  variables?: Record<string, string>;
  maxSteps?: number;
}
