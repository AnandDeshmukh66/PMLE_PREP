import { USER_AGENT } from "./robots";
import { IngestError } from "./types";
import { parsePublicUrl } from "./url-safety";

export type Rendered = { html: string; screenshot: Buffer | null; finalUrl: string };
export type Renderer = (url: string, opts: { timeoutMs: number }) => Promise<Rendered>;

/** Browser rendering is opt-out (INGEST_BROWSER=off) and only used after plain HTTP found no questions. */
export const browserAllowed = () => process.env.INGEST_BROWSER !== "off";

/**
 * Renders a page in headless Chromium (Playwright) without cookies or stored credentials, and takes a full-page
 * screenshot for the OCR fallback. Sub-requests to private or local addresses are blocked.
 */
export const playwrightRenderer: Renderer = async (url, { timeoutMs }) => {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new IngestError("ENGINE_UNAVAILABLE", "Playwright is not installed, so JavaScript-rendered pages cannot be processed.");
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    throw new IngestError("ENGINE_UNAVAILABLE", "No Chromium build is installed for Playwright (run `npx playwright install chromium`).");
  }
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT, javaScriptEnabled: true, acceptDownloads: false, viewport: { width: 1280, height: 1600 } });
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      try {
        parsePublicUrl(route.request().url());
        return route.continue();
      } catch {
        return route.abort();
      }
    });
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw new IngestError("TIMEOUT", `The page did not finish loading within ${Math.round(timeoutMs / 1000)} s in the browser.`);
      throw new IngestError("NETWORK", "The browser could not load the page.");
    }
    const html = await page.content();
    const screenshot = await page.screenshot({ fullPage: true, type: "png" }).catch(() => null);
    return { html, screenshot: screenshot ? Buffer.from(screenshot) : null, finalUrl: page.url() };
  } finally {
    await browser.close().catch(() => undefined);
  }
};
