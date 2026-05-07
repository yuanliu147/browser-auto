import type { BrowserContext, Page } from "playwright";

export class PageManager {
  private context: BrowserContext;
  private current: Page | null = null;

  constructor(context: BrowserContext) {
    this.context = context;
    context.on("page", (page) => {
      this.current = page;
      page.on("close", () => {
        if (this.current === page) {
          const remaining = context.pages();
          this.current = remaining[remaining.length - 1] ?? null;
        }
      });
    });
  }

  async getCurrent(): Promise<Page> {
    if (this.current && !this.current.isClosed()) return this.current;
    const pages = this.context.pages();
    if (pages.length > 0) {
      this.current = pages[pages.length - 1] ?? null;
    }
    if (!this.current) {
      this.current = await this.context.newPage();
    }
    return this.current;
  }

  list(): Page[] {
    return this.context.pages();
  }

  async switchByIndex(index: number): Promise<Page> {
    const pages = this.list();
    const page = pages[index];
    if (!page)
      throw new Error(`No page at index ${index} (total: ${pages.length})`);
    this.current = page;
    await page.bringToFront();
    return page;
  }

  async newPage(url?: string): Promise<Page> {
    const page = await this.context.newPage();
    this.current = page;
    if (url) await page.goto(url);
    return page;
  }
}
