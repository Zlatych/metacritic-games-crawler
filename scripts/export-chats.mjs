// Copies the raw Claude Code session transcripts (JSONL) for this project into ./chats,
// masking personal and sensitive data on the way.
// Usage: npm run export-chats [-- <path to ~/.claude/projects/<project> dir>]
// Extra literals to mask: MASK_TERMS="term1,term2" npm run export-chats
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Claude Code stores sessions under ~/.claude/projects/<cwd with every non-alphanumeric char replaced by "-">.
const projectKey = root.replace(/[^a-zA-Z0-9]/g, "-");
const projects = path.join(homedir(), ".claude", "projects");
const source =
  process.argv[2] ??
  readdirSync(projects, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.toLowerCase() === projectKey.toLowerCase())
    .map((d) => path.join(projects, d.name))[0];

if (!source || !existsSync(source)) {
  console.error(`No transcripts found for ${projectKey} in ${projects}`);
  process.exit(1);
}

// --- What gets masked ----------------------------------------------------------------------
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/g;
const IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g;
const IPV4_PARTIAL = /(?<![\d.])\d{1,3}\.\d{1,3}\.(?:\d{1,3}|[x*])\.[x*](?![\w.])/gi; // e.g. "146.75.x.x"
const IPV6 = /(?<![\w:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}:?){1,6})(?![\w:])/gi;
// Keys and tokens: Google/Firebase, Groq, OpenAI/OpenRouter/Anthropic, GitHub, Slack, AWS, JWT, bearer headers.
const SECRET =
  /\b(?:AIza[0-9A-Za-z_-]{30,}|gsk_[A-Za-z0-9]{20,}|sk-(?:or-|proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})|(?<=[Bb]earer )[A-Za-z0-9._~+/=-]{16,}/g;
// Account identifiers: masked as values of these keys, and wherever else the same value shows up.
const ACCOUNT_KEYS = /^(organizationUuid|organizationId|orgId|accountUuid|accountId|userId|userID|deviceId|anonymousId)$/;
const ACCOUNT_KEY_IN_TEXT = /("(?:organizationUuid|organizationId|orgId|accountUuid|accountId|userId|userID|deviceId|anonymousId)"\s*:\s*")[^"]+/g;
// Loopback / unspecified addresses identify nothing and are kept so commands like curl 127.0.0.1:3000 stay readable.
const KEEP_IPS = new Set(["127.0.0.1", "0.0.0.0", "255.255.255.255"]);
const KEEP_EMAILS = new Set(["noreply@anthropic.com"]); // public commit attribution

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const literal = (terms) =>
  terms.length ? new RegExp(`(?<![A-Za-z0-9])(?:${[...terms].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![A-Za-z0-9])`, "gi") : null;

// --- Pass 1: collect identifiers that must also be masked as bare literals -------------------
const files = readdirSync(source, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
  .map((e) => path.join(e.parentPath, e.name));

const emailLocals = new Set();
const accountIds = new Set();
function collect(value, key) {
  if (typeof value === "string") {
    if (key && ACCOUNT_KEYS.test(key)) accountIds.add(value);
    for (const [e] of value.matchAll(EMAIL)) if (!KEEP_EMAILS.has(e.toLowerCase())) emailLocals.add(e.split("@")[0]);
    for (const m of value.matchAll(ACCOUNT_KEY_IN_TEXT)) accountIds.add(m[0].slice(m[1].length));
  } else if (Array.isArray(value)) value.forEach((v) => collect(v));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) collect(v, k);
}
const parsed = new Map(
  files.map((f) => [
    f,
    readFileSync(f, "utf8")
      .split("\n")
      .map((line) => {
        if (!line.trim()) return { raw: line };
        try {
          const obj = JSON.parse(line);
          collect(obj);
          return { obj };
        } catch {
          return { raw: line };
        }
      }),
  ]),
);

const userTerms = [userInfo().username, path.basename(homedir()), hostname(), ...(process.env.MASK_TERMS ?? "").split(",")]
  .map((s) => s.trim())
  .filter((s) => s.length >= 3);
const USER = literal([...new Set(userTerms)]);
const EMAIL_LOCAL = literal([...emailLocals].filter((l) => l.length >= 5));
// UUIDs are often shortened to their first block, so mask that too.
const ACCOUNT = literal([...accountIds].flatMap((id) => [id, id.split("-")[0]]).filter((s) => s.length >= 8));

// --- Pass 2: mask every string (keys included) and re-serialize, so the output is always valid JSONL ----
const stats = {};
const hit = (key) => (stats[key] = (stats[key] ?? 0) + 1);
const sub = (text, re, replacement, key) =>
  re
    ? text.replace(re, (...m) => {
        const r = typeof replacement === "function" ? replacement(...m) : replacement;
        if (r !== m[0]) hit(key);
        return r;
      })
    : text;

function maskString(s) {
  s = sub(s, EMAIL, (e) => (KEEP_EMAILS.has(e.toLowerCase()) ? e : "[EMAIL]"), "email");
  s = sub(s, EMAIL_LOCAL, "[EMAIL]", "email");
  s = sub(s, SECRET, "[SECRET]", "secret");
  s = sub(s, ACCOUNT_KEY_IN_TEXT, (_, k) => `${k}[ID]`, "account id");
  s = sub(s, ACCOUNT, "[ID]", "account id");
  s = sub(s, IPV4, (ip) => (KEEP_IPS.has(ip) ? ip : "[IP]"), "ip");
  s = sub(s, IPV4_PARTIAL, "[IP]", "ip");
  s = sub(s, IPV6, "[IP]", "ip");
  s = sub(s, USER, "user", "username/hostname");
  return s;
}

function maskValue(value, key) {
  if (typeof value === "string") return key && ACCOUNT_KEYS.test(key) ? (hit("account id"), "[ID]") : maskString(value);
  if (Array.isArray(value)) return value.map((v) => maskValue(v));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [maskString(k), maskValue(v, k)]));
  return value;
}

const target = path.join(root, "chats");
for (const [from, lines] of parsed) {
  const to = path.join(target, path.relative(source, from));
  mkdirSync(path.dirname(to), { recursive: true });
  const out = lines.map((l) => (l.obj !== undefined ? JSON.stringify(maskValue(l.obj)) : maskString(l.raw)));
  writeFileSync(to, out.join("\n"));
}
console.log(`Copied ${files.length} transcript(s) from ${source} to ${target}`);
console.log("Masked:", Object.keys(stats).length ? stats : "nothing");
