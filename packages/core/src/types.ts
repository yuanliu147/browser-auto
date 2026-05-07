import type { Browser, BrowserContext } from "playwright";

export interface BrowserConfig {
  headless?: boolean;
  channel?: string;
  args?: string[];
  browser?: Browser;
  context?: BrowserContext;
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
}

export interface ActOptions {
  variables?: Record<string, string>;
  maxSteps?: number;
}
