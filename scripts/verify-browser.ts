import {
  createBrowserContext,
  closeBrowserContext,
} from "../packages/core/src/browser/index.js";
import { PageManager } from "../packages/core/src/browser/page.js";

async function main() {
  console.log("1. Creating browser context...");
  const handles = await createBrowserContext({ headless: false });
  console.log("  ✓ Browser started");
  console.log(`  ownsBrowser: ${handles.ownsBrowser}`);

  const pageManager = new PageManager(handles.context);
  const page = await pageManager.getCurrent();
  console.log("  ✓ Got current page");

  console.log("2. Navigating to example.com...");
  await page.goto("https://example.com");
  console.log(`  ✓ Page title: "${await page.title()}"`);

  console.log("3. Taking screenshot...");
  const buf = await page.screenshot({ path: "/tmp/browser-auto-verify.png" });
  console.log(`  ✓ Screenshot saved (${buf.length} bytes)`);

  console.log("4. Closing browser...");
  await closeBrowserContext(handles);
  console.log("  ✓ Browser closed");

  console.log("\nAll checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
