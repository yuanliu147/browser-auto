## 1. Type Definitions

- [x] 1.1 Define `TraceConfig`, `TraceStep`, `TraceToolCall`, `TraceSummary` types in `packages/core/src/logger/types.ts`
- [x] 1.2 Extend `AgentOptions` with optional `trace?: { outputDir?: string }`
- [x] 1.3 Keep `ActOptions` unchanged (no trace-related fields)
- [x] 1.4 Export new types from `packages/core/src/index.ts`

## 2. TraceRecorder Core

- [x] 2.1 Implement `TraceRecorder` class with constructor accepting `PageManager` and `TraceConfig`
- [x] 2.2 Implement `onStart(instruction)` to initialize trace metadata and create output directory
- [x] 2.3 Implement `onToolCallStart(event)` to record tool call args and capture `screenshotBefore` for interaction tools
- [x] 2.4 Implement `onToolCallFinish(event)` to record result/duration/error and capture `screenshotAfter` with 100ms delay for interaction tools
- [x] 2.5 Implement `onStepFinish(event)` to record LLM reasoning text and aggregate tool calls into steps
- [x] 2.6 Implement `onFinish(event)` to record final state and total token usage
- [x] 2.7 Implement `flush()` to write `trace.json` and `log.txt` to disk
- [x] 2.8 Add TODO comment at `flush()` marking future extension for remote upload / custom sinks

## 3. Directory and Screenshot Utilities

- [x] 3.1 Implement `createTraceDir(outputDir, seq, instruction)` to generate `{seq}-{instruction-slug}-{HHMMSS}` directory under output root
- [x] 3.2 Implement `takeScreenshot(page)` helper with try/catch that returns `{ path: string | null, error?: string }`
- [x] 3.3 Implement `generateLogText(trace)` to produce human-readable summary from trace data
- [x] 3.4 Define `INTERACTION_TOOLS` constant set: `['click', 'fill', 'press', 'hover', 'select']`
- [x] 3.5 Add TODO comment at screenshot save logic marking future extension for OSS/S3 upload

## 4. Agent Integration

- [x] 4.1 Modify `BrowserAgent.create()` to accept `trace` config from `AgentOptions` and initialize `TraceRecorder`
- [x] 4.2 Modify `BrowserAgent.act()` to wire `generateText` callbacks to `TraceRecorder` methods when trace is enabled
- [x] 4.3 Ensure `TraceRecorder.flush()` is called in `finally` block of `act()`
- [x] 4.4 Ensure zero-overhead when trace is not configured (no recorder, no callbacks)

## 5. Build and Verification

- [x] 5.1 Run `pnpm run build` in `packages/core` to verify TypeScript compiles without errors
- [x] 5.2 Update `examples/test-login.ts` to demonstrate trace usage via `AgentOptions`
- [x] 5.3 Verify trace output structure: `trace.json`, `log.txt`, `screenshots/` with before/after PNGs (verified via code review — runtime test requires API key)
- [x] 5.4 Verify zero-overhead path: Agent without `trace` config produces no files and no behavioral change (verified via code review — `recorder` is undefined when trace is not configured)
