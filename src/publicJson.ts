/** Keys never shown in public tool or route output. Chain-ID validation still runs internally (SDK, RPC checks). */
const HIDDEN_KEYS = new Set(["chainId", "chainIdHex", "expectedChainId", "chosenChainId"]);

/** JSON.stringify replacer for public output: drops chain-ID fields, stringifies bigint. */
export function publicReplacer(key: string, value: unknown): unknown {
  if (HIDDEN_KEYS.has(key)) return undefined;
  if (typeof value === "bigint") return value.toString();
  return value;
}
