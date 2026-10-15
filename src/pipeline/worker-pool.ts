import { log } from "../lib/log";
import { errorMessage } from "../lib/util";
import { type PoolLike, type PoolState, type WorkerState, monitor } from "./monitor";

/**
 * A named pool of long-lived async workers consuming an in-memory queue.
 * Each worker reports its status to the monitor; `drain()` waits until the queue is empty and all workers are idle.
 */
export class WorkerPool<T> implements PoolLike {
  private queue: T[] = [];
  private wakeups: (() => void)[] = [];
  private drainWaiters: (() => void)[] = [];
  private workers: WorkerState[];
  private busy = 0;

  constructor(
    readonly name: string,
    readonly title: string,
    size: number,
    private handler: (job: T) => Promise<void>,
    private label: (job: T) => string,
  ) {
    this.workers = Array.from({ length: size }, (_, i) => ({
      id: `${name}-${i + 1}`,
      status: "idle",
      task: null,
      since: new Date().toISOString(),
      processed: 0,
      failed: 0,
      lastError: null,
    }));
    monitor.pools.push(this);
    for (const w of this.workers) void this.loop(w);
  }

  push(job: T) {
    this.queue.push(job);
    this.wakeups.shift()?.();
    monitor.changed();
  }

  drain(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((r) => this.drainWaiters.push(r));
  }

  private isIdle() {
    return this.queue.length === 0 && this.busy === 0;
  }

  private async next(): Promise<T> {
    while (this.queue.length === 0) await new Promise<void>((r) => this.wakeups.push(r));
    return this.queue.shift()!;
  }

  private async loop(w: WorkerState) {
    for (;;) {
      const job = await this.next();
      this.busy++;
      Object.assign(w, { status: "busy", task: this.label(job), since: new Date().toISOString() });
      monitor.changed();
      try {
        await this.handler(job);
        w.processed++;
      } catch (e) {
        w.failed++;
        w.lastError = errorMessage(e);
        log.error(`${w.id}: ${this.label(job)} — ${w.lastError}`);
      } finally {
        this.busy--;
        Object.assign(w, { status: "idle", task: null, since: new Date().toISOString() });
        if (this.isIdle()) this.drainWaiters.splice(0).forEach((r) => r());
        monitor.changed();
      }
    }
  }

  state(): PoolState {
    return {
      name: this.name,
      title: this.title,
      queued: this.queue.length,
      processed: this.workers.reduce((s, w) => s + w.processed, 0),
      failed: this.workers.reduce((s, w) => s + w.failed, 0),
      workers: this.workers,
    };
  }
}
