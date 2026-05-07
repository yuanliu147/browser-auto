import { existsSync } from "node:fs";

function getMacOSChromePath(): string | undefined {
  const path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return existsSync(path) ? path : undefined;
}

function getLinuxChromePath(): string | undefined {
  const candidates = [
    "/opt/google/chrome/chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => existsSync(p));
}

function getWindowsChromePath(): string | undefined {
  const suffix = "\\Google\\Chrome\\Application\\chrome.exe";
  const prefixes = [
    process.env.LOCALAPPDATA,
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
  ].filter(Boolean) as string[];

  for (const prefix of prefixes) {
    const path = prefix + suffix;
    if (existsSync(path)) return path;
  }
  return undefined;
}

export function getChromePath(): string {
  const envPath = process.env.CHROME_PATH;
  if (envPath) {
    if (existsSync(envPath)) return envPath;
    throw new Error(
      `CHROME_PATH is set to "${envPath}" but the file does not exist.`
    );
  }

  const platform = process.platform;
  let path: string | undefined;

  if (platform === "darwin") {
    path = getMacOSChromePath();
  } else if (platform === "linux") {
    path = getLinuxChromePath();
  } else if (platform === "win32") {
    path = getWindowsChromePath();
  }

  if (path) return path;

  throw new Error(
    `Chrome not found. Please install Google Chrome or set CHROME_PATH environment variable.`
  );
}
