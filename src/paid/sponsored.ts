/**
 * Server-side per-key spending limits, configured by the server administrator.
 * Format: "<apiKeyId>:<limitUsdc>[:<YYYY-MM-DD expiry>],..."
 * Key ids only, never full keys. Usage is persisted in the state folder so limits survive restarts.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type SponsoredEntry = { keyId: string; limitAtomic: bigint; expires?: Date };

export function parseSponsoredKeys(raw = process.env.VEYA_PAID_SPONSORED_KEYS ?? ""): Map<string, SponsoredEntry> {
  const out = new Map<string, SponsoredEntry>();
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [keyId, limit, expiry] = part.split(":").map((s) => s.trim());
    if (!/^[0-9a-f-]{36}$/i.test(keyId ?? "") || !/^\d+(\.\d{1,6})?$/.test(limit ?? "")) throw new Error("CONFIG: VEYA_PAID_SPONSORED_KEYS entries must be <apiKeyId>:<limitUsdc>[:<YYYY-MM-DD>]");
    const [w, f = ""] = limit.split(".");
    const expires = expiry ? new Date(`${expiry}T23:59:59Z`) : undefined;
    if (expires && Number.isNaN(expires.getTime())) throw new Error("CONFIG: bad expiry date in VEYA_PAID_SPONSORED_KEYS");
    out.set(keyId.toLowerCase(), { keyId: keyId.toLowerCase(), limitAtomic: BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0")), expires });
  }
  return out;
}

type Book = Record<string, { spentAtomic: string; reservedAtomic: string }>;

export class SponsorLedger {
  private book: Book;
  private file: string;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "sponsored.json");
    this.book = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : {};
    // Reservations never survive a restart: a reserved-but-unsettled amount is kept as spent (conservative).
    for (const v of Object.values(this.book)) { v.spentAtomic = (BigInt(v.spentAtomic) + BigInt(v.reservedAtomic)).toString(); v.reservedAtomic = "0"; }
    this.save();
  }
  private save() { writeFileSync(this.file + ".tmp", JSON.stringify(this.book, null, 2)); renameSync(this.file + ".tmp", this.file); }
  private row(id: string) { return (this.book[id] ??= { spentAtomic: "0", reservedAtomic: "0" }); }
  used(id: string): bigint { const r = this.row(id); return BigInt(r.spentAtomic) + BigInt(r.reservedAtomic); }
  /** Synchronous check-and-reserve, so parallel calls cannot both pass the limit. */
  reserve(e: SponsoredEntry, amount: bigint, now = new Date()): { ok: true } | { ok: false; reason: string } {
    if (e.expires && now > e.expires) return { ok: false, reason: "KEY_LIMIT_EXPIRED: this API key's call limit has expired. Pass your own solanaPrivateKey and robinhoodPrivateKey. Nothing was signed or spent." };
    const used = this.used(e.keyId);
    if (used + amount > e.limitAtomic) return { ok: false, reason: `KEY_LIMIT_REACHED: this API key's call limit is used up (${used} of ${e.limitAtomic} atomic USDC; this call needs ${amount}). Pass your own solanaPrivateKey and robinhoodPrivateKey. Nothing was signed or spent.` };
    const r = this.row(e.keyId); r.reservedAtomic = (BigInt(r.reservedAtomic) + amount).toString(); this.save();
    return { ok: true };
  }
  settle(id: string, reserved: bigint, spent: bigint) {
    const r = this.row(id);
    r.reservedAtomic = (BigInt(r.reservedAtomic) - reserved).toString(); r.spentAtomic = (BigInt(r.spentAtomic) + spent).toString(); this.save();
  }
}
