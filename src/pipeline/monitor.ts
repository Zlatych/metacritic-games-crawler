/** In-memory live state of the service, streamed to the web UI over SSE. */

export type WorkerState = {
  id: string;
  status: "idle" | "busy";
  task: string | null;
  since: string;
  processed: number;
  failed: number;
  lastError: string | null;
};

export type PoolState = { name: string; title: string; queued: number; processed: number; failed: number; workers: WorkerState[] };

export type RunState = {
  id: number;
  trigger: string;
  stage: string;
  startedAt: string;
  selected: number;
  scraped: number;
  failed: number;
};

export type MonitorEvent = { at: string; level: "info" | "warn" | "error"; msg: string };

export interface PoolLike {
  state(): PoolState;
}

class Monitor {
  readonly pools: PoolLike[] = [];
  run: RunState | null = null;
  nextRunAt: () => Date | null = () => null;
  private events: MonitorEvent[] = [];
  private listeners = new Set<() => void>();

  event(level: MonitorEvent["level"], msg: string) {
    this.events.push({ at: new Date().toISOString(), level, msg });
    if (this.events.length > 200) this.events.shift();
    this.changed();
  }

  setStage(stage: string) {
    if (this.run) this.run.stage = stage;
    this.changed();
  }

  changed() {
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot() {
    return {
      now: new Date().toISOString(),
      run: this.run,
      nextRunAt: this.nextRunAt()?.toISOString() ?? null,
      pools: this.pools.map((p) => p.state()),
      events: this.events.slice(-60).reverse(),
    };
  }
}

export const monitor = new Monitor();
