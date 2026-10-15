import { createHash } from "node:crypto";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Local calendar day (YYYY-MM-DD) — the crawl restarts from New Releases every new day. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Minimal counting semaphore to cap concurrent requests to an upstream. */
export class Semaphore {
  private queue: (() => void)[] = [];
  constructor(private slots: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.slots > 0) this.slots--;
    else await new Promise<void>((r) => this.queue.push(r));
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.slots++;
    }
  }
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}
