import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { monitor } from "../pipeline/monitor";
import { isRunning, triggerRun } from "../pipeline/runner";
import { allPlatforms, getGame, listGames, SORTS, serviceStats } from "./queries";
import { GamePage, IndexPage, MonitorPage, NotFoundPage } from "./views";

const listQuery = z.object({
  q: z.string().max(200).optional(),
  platform: z.string().max(100).optional().transform((v) => v || undefined),
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS, ...(keyof typeof SORTS)[]]).catch("metascore"),
  page: z.coerce.number().int().min(1).catch(1),
});

const monitorSnapshot = () => ({ ...monitor.snapshot(), running: isRunning(), stats: serviceStats() });

export const app = new Hono();

// --- HTML pages ---------------------------------------------------------------------------
app.get("/", (c) => {
  const params = listQuery.parse(c.req.query());
  const { items, total } = listGames(params);
  return c.html(<IndexPage items={items} total={total} params={params} platforms={allPlatforms()} />);
});

app.get("/game/:slug", (c) => {
  const game = getGame(c.req.param("slug"));
  return game ? c.html(<GamePage game={game} />) : c.html(<NotFoundPage />, 404);
});

app.get("/monitor", (c) => c.html(<MonitorPage />));

// --- JSON API -----------------------------------------------------------------------------
app.get("/api/games", (c) => c.json(listGames(listQuery.parse(c.req.query()))));

app.get("/api/games/:slug", (c) => {
  const game = getGame(c.req.param("slug"));
  return game ? c.json(game) : c.json({ error: "not found" }, 404);
});

app.get("/api/platforms", (c) => c.json(allPlatforms()));

app.post("/api/run", (c) => {
  const started = triggerRun("manual");
  return c.json({ started, message: started ? "Обработка запущена" : "Обработка уже идёт" }, started ? 202 : 409);
});

app.get("/api/monitor", (c) => c.json(monitorSnapshot()));

/** Server-Sent Events: pushes a fresh snapshot on every state change (throttled) plus a heartbeat. */
app.get("/api/monitor/stream", (c) =>
  streamSSE(c, async (stream) => {
    let dirty = true;
    const unsubscribe = monitor.subscribe(() => (dirty = true));
    stream.onAbort(() => {
      unsubscribe();
    });
    let ticks = 0;
    while (!stream.aborted) {
      if (dirty || ++ticks % 10 === 0) {
        dirty = false;
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify(monitorSnapshot()) });
      }
      await stream.sleep(500);
    }
    unsubscribe();
  }),
);
