/**
 * The caller's own Solana payer key, passed per call as a tool argument. Parsed in memory only:
 * it is never logged, stored, put in state, receipts or errors, and the bytes are zeroed after the call.
 */
import { readFileSync } from "node:fs";
import { getBase58Codec } from "@solana/kit";

const b58 = getBase58Codec();

export type ParsedPayer = { secret: Uint8Array; address: string };

export class PayerKeyError extends Error {}

/** Accepts a base58 secret key (Phantom / Solflare export) or a JSON array of 64 numbers (solana-keygen file). */
export async function parsePayerKey(raw: string): Promise<ParsedPayer> {
  const t = raw.trim();
  let bytes: Uint8Array | undefined;
  try {
    if (t.startsWith("[")) {
      const arr = JSON.parse(t) as unknown;
      if (Array.isArray(arr) && arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) bytes = Uint8Array.from(arr as number[]);
    } else if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(t)) bytes = Uint8Array.from(b58.encode(t));
  } catch { bytes = undefined; }
  if (!bytes || bytes.length !== 64) {
    bytes?.fill(0);
    throw new PayerKeyError("SOLANA_KEY_INVALID: solanaPrivateKey must be a Solana secret key (base58, or a JSON array of 64 numbers).");
  }
  try {
    const { createKeyPairSignerFromBytes } = await import("@solana/kit");
    const signer = await createKeyPairSignerFromBytes(Uint8Array.from(bytes));
    return { secret: bytes, address: signer.address };
  } catch {
    bytes.fill(0);
    throw new PayerKeyError("SOLANA_KEY_INVALID: solanaPrivateKey is not a valid Solana keypair.");
  }
}

/** Public address of the operator key file (self-host fallback): the last 32 bytes of a Solana secret are the public key. */
export function addressFromKeyFile(path: string): string {
  const b = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]);
  const addr = b58.decode(b.slice(32, 64));
  b.fill(0);
  return addr;
}
