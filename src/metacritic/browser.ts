import { type Browser, type BrowserContext, chromium } from "playwright";
import { log } from "../lib/log";

/**
 * Playwright fallback for when direct requests to Metacritic's backend get blocked
 * (403/429, bot protection). It opens www.metacritic.com in real Chromium once, then
 * fetches the same JSON endpoints through the browser context (shared cookies, real TLS fingerprint).
 */
let browser: Browser | null = null;
let context: Promise<BrowserContext> | null = null;

async function getContext(): Promise<BrowserContext> {
  context ??= (async () => {
    log.info("playwright: launching chromium fallback");
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ locale: "en-US" });
    const page = await ctx.newPage();
    await page.goto("https://www.metacritic.com/game/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.close();
    return ctx;
  })().catch((e) => {
    context = null;
    throw e;
  });
  return context;
}

export async function browserFetchJson(url: string): Promise<unknown> {
  const ctx = await getContext();
  const res = await ctx.request.get(url, { timeout: 30_000, headers: { referer: "https://www.metacritic.com/" } });
  if (!res.ok()) throw new Error(`browser fetch ${res.status()} ${url}`);
  return res.json();
}

export async function closeBrowser() {
  await browser?.close().catch(() => {});
  browser = null;
  context = null;
}
