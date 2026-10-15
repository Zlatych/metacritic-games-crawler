import { config } from "../config";
import { log } from "../lib/log";
import { Semaphore, errorMessage, sleep } from "../lib/util";
import { browserFetchJson } from "./browser";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const limiter = new Semaphore(config.MC_CONCURRENCY);
let useBrowser = config.MC_FETCH_MODE === "browser";

class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

const isRetryable = (e: unknown) => !(e instanceof HttpError) || e.status === 429 || e.status >= 500;
const isBlocked = (e: unknown) => e instanceof HttpError && (e.status === 403 || e.status === 429);

async function directFetch(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json", referer: "https://www.metacritic.com/" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.json();
}

/** GET JSON with concurrency cap, exponential backoff and an automatic Playwright fallback. */
export function getJson(url: string, attempts = 3): Promise<unknown> {
  return limiter.run(async () => {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return useBrowser ? await browserFetchJson(url) : await directFetch(url);
      } catch (e) {
        lastError = e;
        if (!useBrowser && config.MC_FETCH_MODE === "auto" && isBlocked(e)) {
          log.warn(`metacritic: direct API blocked (${errorMessage(e)}), switching to Playwright`);
          useBrowser = true;
          continue;
        }
        if (!isRetryable(e)) break;
        await sleep(1000 * 2 ** i);
      }
    }
    throw lastError;
  });
}
