import { spawn } from "node:child_process";
import { getChromePath } from "./chrome-path.js";

const DEFAULT_CDP_TIMEOUT = 15000;

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
