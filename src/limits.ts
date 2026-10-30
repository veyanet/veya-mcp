import { createHash } from "node:crypto";

const perMinute = new Map<string, { window: number; count: number }>();
const perDay = new Map<string, { day: string; count: number }>();
const globalDay = { day: "", count: 0 };

function keyId(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function capacityPerMinute(): number {
  const parsed = Number(process.env.VEYA_CAPACITY_PER_MINUTE || 30);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export function sealDailyCap(): number {
  const parsed = Number(process.env.VEYA_SEAL_DECISION_DAILY_CAP || 20);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

export function sealGlobalDailyCap(): number {
  const parsed = Number(process.env.VEYA_SEAL_DECISION_GLOBAL_DAILY_CAP || 100);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Counts this call. Throws when the key is over the per-minute cap. The raw key is not stored. */
export function assertKeyRate(apiKey: string, limit = capacityPerMinute()): void {
  const id = keyId(apiKey);
  const window = Math.floor(Date.now() / 60_000);
  const row = perMinute.get(id);
  if (!row || row.window !== window) {
    perMinute.set(id, { window, count: 1 });
    return;
  }
  row.count += 1;
  if (row.count > limit) {
    throw new Error(`API key limit: ${limit} requests per minute`);
  }
}

/** Throws when this key or the host is already at the UTC-day relayer cap. Does not count the attempt. */
export function assertRelayerDaily(
  apiKey: string,
  limit = sealDailyCap(),
  globalLimit = sealGlobalDailyCap(),
): void {
  const id = keyId(apiKey);
  const day = utcDay();
  const row = perDay.get(id);
  const keyCount = !row || row.day !== day ? 0 : row.count;
  if (keyCount >= limit) {
    throw new Error(`Daily seal limit: ${limit} host-signer sends for this API key`);
  }
  const globalCount = globalDay.day === day ? globalDay.count : 0;
  if (globalCount >= globalLimit) {
    throw new Error(`Daily seal limit: ${globalLimit} host-signer sends for this host`);
  }
}

/** Counts one successful host-sent seal against the key and the host. */
export function recordRelayerSeal(apiKey: string): void {
  const id = keyId(apiKey);
  const day = utcDay();
  const row = perDay.get(id);
  if (!row || row.day !== day) perDay.set(id, { day, count: 1 });
  else row.count += 1;
  if (globalDay.day !== day) {
    globalDay.day = day;
    globalDay.count = 1;
  } else {
    globalDay.count += 1;
  }
}
