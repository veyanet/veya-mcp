import { ethers } from "ethers";
import type { McpServiceConfig } from "./config.js";
import { apiRequest } from "./api.js";
import { MINT_API_KEY_HINT, NO_TESTNET_TOKENS } from "./credentials.js";

export { NO_TESTNET_TOKENS };

export function resolvePayerPrivateKey(
  cfg: McpServiceConfig,
  toolArg?: string | null,
): string {
  const fromArg = toolArg?.trim() || "";
  const fromEnv = cfg.payerPrivateKey?.trim() || "";
  const key = fromArg || fromEnv;
  if (!key) {
    throw new Error(
      "payerPrivateKey required. Pass it as a tool argument or set VEYA_PAYER_PRIVATE_KEY. On-chain writes spend YOUR wallet, not the hosted relayer.",
    );
  }
  try {
    // Validates 0x-prefixed 32-byte hex without logging the key.
    new ethers.Wallet(key);
  } catch {
    throw new Error("payerPrivateKey must be a 0x-prefixed 32-byte hex private key");
  }
  return key;
}

export function payerAddress(privateKey: string): string {
  return new ethers.Wallet(privateKey).address;
}

export function mapWriteError(err: unknown): Error {
  const message =
    err instanceof Error
      ? `${err.message} ${String((err as { shortMessage?: string; code?: string }).shortMessage ?? "")} ${String((err as { code?: string }).code ?? "")}`
      : err && typeof err === "object"
        ? `${String((err as { message?: unknown }).message ?? "")} ${String((err as { shortMessage?: unknown }).shortMessage ?? "")} ${String((err as { code?: unknown }).code ?? "")}`
        : String(err);
  if (
    /insufficient funds|insufficient balance|INSUFFICIENT_FUNDS|exceeds the balance|intrinsic gas too low|don't have testnet tokens|UNFUNDED_PAYER/i.test(
      message,
    )
  ) {
    return new Error(NO_TESTNET_TOKENS);
  }
  return err instanceof Error ? err : new Error(message.trim() || String(err));
}

export async function assertPayerFunded(
  cfg: McpServiceConfig,
  privateKey: string,
): Promise<{ address: string; balanceWei: string }> {
  const wallet = new ethers.Wallet(privateKey);
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const balance = await provider.getBalance(wallet.address);
  if (balance === 0n) {
    throw new Error(NO_TESTNET_TOKENS);
  }
  return { address: wallet.address, balanceWei: balance.toString() };
}

export type AccountIdentity = {
  wallet: string;
  accountId?: string;
  isGuest?: boolean;
};

export async function readAccountForKey(
  cfg: McpServiceConfig,
  apiKey: string,
): Promise<AccountIdentity> {
  const result = await apiRequest(cfg, "/v1/account", { apiKey });
  const body = result.body as { wallet?: string; isGuest?: boolean; accountId?: string; error?: string };
  if (result.httpStatus >= 400 || !body?.wallet) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `Product API rejected this apiKey (HTTP ${result.httpStatus})`,
    );
  }
  if (body.isGuest) {
    throw new Error(MINT_API_KEY_HINT);
  }
  return { wallet: body.wallet, accountId: body.accountId, isGuest: body.isGuest };
}

export function assertPayerMatchesAccount(payerAddr: string, accountWallet: string): void {
  if (payerAddr.toLowerCase() !== accountWallet.toLowerCase()) {
    throw new Error(
      "payerPrivateKey does not match the wallet on this API key. Use the same wallet that minted the key on the product site.",
    );
  }
}

export async function prepareUserPayer(
  cfg: McpServiceConfig,
  apiKey: string,
  payerArg?: string | null,
): Promise<{ privateKey: string; address: string; balanceWei: string }> {
  const privateKey = resolvePayerPrivateKey(cfg, payerArg);
  const address = payerAddress(privateKey);
  const account = await readAccountForKey(cfg, apiKey);
  assertPayerMatchesAccount(address, account.wallet);
  const funded = await assertPayerFunded(cfg, privateKey);
  return { privateKey, address: funded.address, balanceWei: funded.balanceWei };
}
