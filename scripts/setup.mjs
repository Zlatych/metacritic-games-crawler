// One-time setup: downloads the yt-dlp binary, installs Chromium for Playwright, creates .env.
import { execSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const bin = path.join(root, "bin");
const asset = { win32: "yt-dlp.exe", darwin: "yt-dlp_macos", linux: "yt-dlp_linux" }[process.platform] ?? "yt-dlp";
const target = path.join(bin, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

mkdirSync(bin, { recursive: true });
if (!existsSync(target)) {
  console.log(`Downloading ${asset}…`);
  const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`);
  if (!res.ok) throw new Error(`yt-dlp download failed: HTTP ${res.status}`);
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  if (process.platform !== "win32") chmodSync(target, 0o755);
} else {
  console.log("yt-dlp already present, updating…");
  execSync(`"${target}" -U`, { stdio: "inherit" });
}

console.log("Installing Chromium for Playwright…");
execSync("npx playwright install chromium", { stdio: "inherit", cwd: root });

if (!existsSync(path.join(root, ".env"))) {
  copyFileSync(path.join(root, ".env.example"), path.join(root, ".env"));
  console.log("Created .env from .env.example — put your free LLM_API_KEY there.");
}

try {
  execSync("ffmpeg -version", { stdio: "ignore" });
} catch {
  console.warn("⚠ ffmpeg not found in PATH — needed only for speech-to-text of let's plays without captions.");
}
console.log("Setup done. Run: npm start");
