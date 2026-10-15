import { monitor } from "../pipeline/monitor";

type Level = "info" | "warn" | "error";

function write(level: Level, msg: string) {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  (level === "error" ? console.error : console.log)(line);
  monitor.event(level, msg);
}

export const log = {
  info: (msg: string) => write("info", msg),
  warn: (msg: string) => write("warn", msg),
  error: (msg: string) => write("error", msg),
};
