/** The caller's own Robinhood Chain (EVM) key, passed per call. Memory only: never logged, stored or echoed. */
import { Wallet } from "ethers";

export class RobinhoodKeyError extends Error {}

export function parseRobinhoodKey(raw: string): { key: string; address: string } {
  const t = raw.trim();
  const hex = /^0x[0-9a-fA-F]{64}$/.test(t) ? t : /^[0-9a-fA-F]{64}$/.test(t) ? `0x${t}` : "";
  if (!hex) throw new RobinhoodKeyError("ROBINHOOD_KEY_INVALID: robinhoodPrivateKey must be a 32-byte hex EVM private key (0x + 64 hex characters).");
  try { return { key: hex, address: new Wallet(hex).address }; }
  catch { throw new RobinhoodKeyError("ROBINHOOD_KEY_INVALID: robinhoodPrivateKey is not a valid EVM private key."); }
}
