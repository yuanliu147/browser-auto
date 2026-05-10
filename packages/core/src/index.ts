export { createBrowserAgent, BrowserAgent } from "./agent.js";
export { createBrowserTools } from "./tools/index.js";
export { CDPPageManager } from "./cdp/page.js";
export { createBrowserConnection, closeBrowser } from "./cdp/browser.js";
export { createDeepSeekProvider } from "./llm/provider.js";
export type {
  AgentOptions,
  ActOptions,
  BrowserConfig,
  LLMConfig,
} from "./types.js";
export type { BrowserHandles } from "./cdp/browser.js";
export type {
  TraceConfig,
  TraceData,
  TraceStep,
  TraceToolCall,
  TraceSummary,
} from "./logger/types.js";
