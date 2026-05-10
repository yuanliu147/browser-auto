import { CDPClient } from "./client.js";

interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
}

export class CDPPageManager {
  private browserClient: CDPClient;
  private sessions = new Map<string, string>();
  private currentTargetId: string | null = null;

  constructor(browserClient: CDPClient) {
    this.browserClient = browserClient;
  }

  async init(): Promise<void> {
    await this.browserClient.send("Target.setDiscoverTargets", {
      discover: true,
    });
    this.browserClient.on("Target.targetCreated", (params) => {
      const info = (params as { targetInfo: TargetInfo }).targetInfo;
      if (info.type === "page") {
        this.currentTargetId = info.targetId;
      }
    });
    this.browserClient.on("Target.targetDestroyed", (params) => {
      const { targetId } = params as { targetId: string };
      this.sessions.delete(targetId);
      if (this.currentTargetId === targetId) {
        this.currentTargetId = null;
      }
    });

    const { targetInfos } = (await this.browserClient.send(
      "Target.getTargets"
    )) as { targetInfos: TargetInfo[] };
    const pages = targetInfos.filter((t) => t.type === "page");
    for (const t of pages) {
      await this.attachToTarget(t.targetId);
    }
    if (pages.length > 0) {
      this.currentTargetId = pages[pages.length - 1].targetId;
    }
  }

  private async attachToTarget(targetId: string): Promise<string> {
    const existing = this.sessions.get(targetId);
    if (existing) return existing;

    const { sessionId } = (await this.browserClient.send(
      "Target.attachToTarget",
      { targetId, flatten: true }
    )) as { sessionId: string };

    this.sessions.set(targetId, sessionId);
    return sessionId;
  }

  private async getCurrentSessionId(): Promise<string> {
    const targetId = this.currentTargetId;
    if (!targetId) {
      const { targetId: newTargetId } = (await this.browserClient.send(
        "Target.createTarget",
        { url: "about:blank" }
      )) as { targetId: string };
      this.currentTargetId = newTargetId;
      return this.attachToTarget(newTargetId);
    }

    let sessionId = this.sessions.get(targetId);
    if (!sessionId) {
      sessionId = await this.attachToTarget(targetId);
    }
    return sessionId;
  }

  async send<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const sessionId = await this.getCurrentSessionId();
    return this.browserClient.send(method, params, sessionId);
  }

  async navigate(url: string): Promise<void> {
    await this.send("Page.navigate", { url });
  }

  async getFrameTree(): Promise<Record<string, unknown>> {
    return this.send("Page.getFrameTree");
  }

  async evaluate(expression: string): Promise<unknown> {
    const { result } = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    })) as { result: { value?: unknown } };
    return result?.value;
  }

  async screenshot(): Promise<string> {
    const { data } = (await this.send("Page.captureScreenshot")) as {
      data: string;
    };
    return data;
  }
}
