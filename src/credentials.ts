export const NO_TESTNET_TOKENS =
  "You don't have testnet tokens. Please get them for the transaction.";

export const ROBINHOOD_TESTNET_FAUCET_URL = "https://faucet.testnet.chain.robinhood.com/";

export const MINT_API_KEY_HINT =
  "Mint a product API key on the product site and fund your wallet. Guest sessions cannot write from MCP.";

const PRODUCT_KEY_PREFIXES = ["veya_dev_", "veya_live_", "vya_dev_", "vya_live_"] as const;

export function isProductApiKey(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return PRODUCT_KEY_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function resolveCredential(apiKey?: string | null, sessionToken?: string | null): string | null {
  const key = apiKey?.trim() || sessionToken?.trim() || null;
  return key && key.length >= 10 ? key : null;
}

export function requireProductApiKey(apiKey?: string | null, sessionToken?: string | null): string {
  const credential = resolveCredential(apiKey, sessionToken);
  if (!credential) {
    throw new Error("apiKey required");
  }
  if (!isProductApiKey(credential)) {
    throw new Error(MINT_API_KEY_HINT);
  }
  return credential;
}
