import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { CDPClient } from "./client.js";
import { getChromePath } from "../browser/chrome-path.js";

const DEFAULT_CDP_PORT = 9223;
const DEFAULT_CDP_TIMEOUT = 15000;

export interface BrowserHandles {
  client: CDPClient;
  ownsBrowser: boolean;
  browserPid?: number;
}

export function launchChrome(
  userDataDir: string,
  port: number,
  extraArgs: string[] = []
): ReturnType<typeof spawn> {
  const chromePath = getChromePath();

  const args = [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...extraArgs,
  ];

  const proc = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore",
  });

  proc.unref();

  return proc;
}

export function waitForCDP(
  port: number,
  timeout = DEFAULT_CDP_TIMEOUT
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = async () => {
      if (Date.now() - start > timeout) {
        reject(
          new Error(`Chrome CDP port ${port} not ready within ${timeout}ms`)
        );
        return;
      }

      try {
        const res = await fetch(`http://localhost:${port}/json/version`, {
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) {
          const data = (await res.json()) as { Browser?: string };
          if (data.Browser?.toLowerCase().includes("chrome")) {
            resolve();
            return;
          }
          reject(
            new Error(
              `Port ${port} is occupied by a non-Chrome process (Browser: ${data.Browser})`
            )
          );
          return;
        }
      } catch {
        /* continue polling */
      }

      setTimeout(check, 200);
    };

    check();
  });
}

async function getBrowserWSEndpoint(port: number): Promise<string> {
  const res = await fetch(`http://localhost:${port}/json/version`);
  if (!res.ok) throw new Error(`Failed to get CDP version: ${res.status}`);
  const data = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!data.webSocketDebuggerUrl) {
    throw new Error("No webSocketDebuggerUrl in CDP version response");
  }
  return data.webSocketDebuggerUrl;
}

async function connectToCDP(port: number): Promise<CDPClient> {
  const wsUrl = await getBrowserWSEndpoint(port);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`CDP WebSocket connect timeout: ${wsUrl}`));
    }, 10000);

    ws.on("open", () => {
      clearTimeout(timer);
      resolve(new CDPClient(ws));
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function createBrowserConnection(
  port = DEFAULT_CDP_PORT
): Promise<BrowserHandles> {
  // 1. 尝试复用已运行的 Chrome
  try {
    const client = await connectToCDP(port);
    return { client, ownsBrowser: false };
  } catch {
    // 2. 启动新的 Chrome
  }

  const userDataDir = getUserDataDir();
  const proc = launchChrome(userDataDir, port);
  await waitForCDP(port);
  const client = await connectToCDP(port);

  return {
    client,
    ownsBrowser: true,
    browserPid: proc.pid ?? undefined,
  };
}

export async function closeBrowser(handles: BrowserHandles): Promise<void> {
  if (handles.ownsBrowser && handles.browserPid) {
    try {
      process.kill(handles.browserPid, "SIGKILL");
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  handles.client.close();
}

function getUserDataDir(): string {
  const dir = join(homedir(), ".browser-auto", "profile");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
