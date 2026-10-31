/**
 * Tool-call counts for the hosted MCP, served at GET /stats and read by the API's GET /public/stats.
 *
 * Counts JSON-RPC "tools/call" requests that reach /mcp or /mcp/session after the rate limit and
 * the optional bearer check, once the transport answers with an HTTP status below 400.
 * Only the tool name is kept, and only when it is a registered tool.
 * No IP, key, argument, session id or result is read or stored.
 *
 * One small JSON file holds hourly buckets for the last 35 days plus an all-time total.
 * Folder: VEYA_STATS_DIR, else <VEYA_PAID_ROOT>/state, else ~/.veya/mcp. Writes are batched.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const KEEP_HOURS = 35 * 24;
const SERIES_DAYS = 30;
const SAVE_MS = 5_000;
const FILE = "tool-stats.json";

/** Tools whose names carry billing wording are shown as one group in public counts. */
const METERED_GROUP = "metered_calls";
export function publicToolLabel(tool: string): string {
  return /paid/i.test(tool) ? METERED_GROUP : tool;
}

type FileShape = { version: 1; archivedTotal: number; hours: Record<string, Record<string, number>> };

export function statsDir(): string {
  const explicit = process.env.VEYA_STATS_DIR?.trim();
  if (explicit) return explicit;
  const root = process.env.VEYA_PAID_ROOT?.trim();
  if (root) return join(root, "state");
  return join(homedir(), ".veya", "mcp");
}

function hourKey(at: Date): string {
  return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS).toISOString();
}

export class ToolStats {
  private data: FileShape = { version: 1, archivedTotal: 0, hours: {} };
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(private readonly dir: string | null = statsDir()) {
    if (!dir) return;
    try {
      const p = join(dir, FILE);
      if (existsSync(p)) {
        const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<FileShape>;
        if (raw && typeof raw === "object" && raw.hours && typeof raw.hours === "object") {
          this.data = {
            version: 1,
            archivedTotal: Number.isSafeInteger(raw.archivedTotal) ? (raw.archivedTotal as number) : 0,
            hours: raw.hours as FileShape["hours"],
          };
        }
      }
    } catch {
      // A bad file starts a fresh count rather than stopping the server.
    }
  }

  record(tool: string, at: Date = new Date()): void {
    const key = hourKey(at);
    const bucket = (this.data.hours[key] ??= {});
    bucket[tool] = (bucket[tool] ?? 0) + 1;
    this.dirty = true;
    if (this.dir && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.save();
      }, SAVE_MS);
      this.timer.unref();
    }
  }

  /** Fold hours older than the keep window into archivedTotal. */
  private prune(now: Date): void {
    const cutoff = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - KEEP_HOURS * HOUR_MS;
    for (const [key, tools] of Object.entries(this.data.hours)) {
      if (Date.parse(key) < cutoff) {
        for (const n of Object.values(tools)) this.data.archivedTotal += n;
        delete this.data.hours[key];
      }
    }
  }

  save(now: Date = new Date()): void {
    if (!this.dir || !this.dirty) return;
    try {
      this.prune(now);
      mkdirSync(this.dir, { recursive: true });
      const p = join(this.dir, FILE);
      writeFileSync(`${p}.tmp`, JSON.stringify(this.data));
      renameSync(`${p}.tmp`, p);
      this.dirty = false;
    } catch (err) {
      console.error(`[veyanet/mcp] tool stats not saved: ${(err as Error).name}`);
    }
  }

  summary(now: Date = new Date()) {
    const current = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
    const since = (hours: number) => current - (hours - 1) * HOUR_MS;
    const todayStart = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
    const firstDay = todayStart - (SERIES_DAYS - 1) * DAY_MS;
    const days = new Map<string, number>();
    for (let d = firstDay; d <= todayStart; d += DAY_MS) days.set(new Date(d).toISOString().slice(0, 10), 0);
    const week = new Map<string, number>();
    let total = this.data.archivedTotal;
    let last24h = 0;
    let last7d = 0;
    let last30d = 0;
    for (const [key, tools] of Object.entries(this.data.hours)) {
      const t = Date.parse(key);
      const day = new Date(Math.floor(t / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
      for (const [tool, n] of Object.entries(tools)) {
        total += n;
        if (t >= since(24)) last24h += n;
        if (t >= since(24 * 7)) {
          last7d += n;
          const label = publicToolLabel(tool);
          week.set(label, (week.get(label) ?? 0) + n);
        }
        if (t >= since(24 * 30)) last30d += n;
        if (days.has(day)) days.set(day, (days.get(day) ?? 0) + n);
      }
    }
    return {
      toolCalls: { total, last24h, last7d, last30d },
      daily: [...days.entries()].map(([date, count]) => ({ date, count })),
      topTools7d: [...week.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tool, count]) => ({ tool, count })),
      generatedAt: now.toISOString(),
    };
  }
}

/** Tool names from JSON-RPC "tools/call" messages in a request body (single or batch). */
export function toolCallNames(body: unknown, known: ReadonlySet<string>): string[] {
  const messages = Array.isArray(body) ? body : [body];
  const names: string[] = [];
  for (const m of messages.slice(0, 50)) {
    if (!m || typeof m !== "object") continue;
    const msg = m as { method?: unknown; params?: { name?: unknown } };
    if (msg.method !== "tools/call") continue;
    const name = msg.params?.name;
    if (typeof name === "string" && known.has(name)) names.push(name);
  }
  return names;
}

let shared: ToolStats | null = null;
export function sharedToolStats(): ToolStats {
  return (shared ??= new ToolStats());
}
