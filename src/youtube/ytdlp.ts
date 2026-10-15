import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { config } from "../config";

export const ytdlpAvailable = () => existsSync(config.YTDLP_PATH);

/** Run yt-dlp and resolve with stdout. */
export function ytdlp(args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.YTDLP_PATH, ["--no-warnings", "--no-progress", "--js-runtimes", "node", ...args], { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`yt-dlp timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`yt-dlp exited ${code}: ${err.trim().split("\n").pop() ?? ""}`));
    });
  });
}
