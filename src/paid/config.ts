import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The one x402 payment option VEYA has pinned for a resource. */
export type X402Pin = {
  x402Version: number; scheme: string; network: string; asset: string; assetSymbol: string;
  assetDecimals: number; payTo: string; amount: string; maxTimeoutSeconds: number; feePayer: string;
};
/** How VEYA pays a provider: the provider's xPay SDK (`use()` only) or the standard x402 `exact` scheme. */
export type PayerKind = "xpay-sdk" | "x402-exact";
export type InputKind = "solana-address" | "slug" | "string";
export type PaidProvider = {
  id: string; label: string; payer: PayerKind;
  /** Only for payer "xpay-sdk": the SDK's own platform fee and guardrail settings. */
  sdk?: {
    platformFee: { url: string; amountAtomic: string; payTo: string };
    guardrail: { maxPerTx: number; maxPerDay: number; allowedHosts: string[]; requireApprovalAbove: number };
  };
};
export type PaidResource = {
  id: string; provider: string; payer?: PayerKind; url: string; method: string; description: string;
  input: { required: string[]; optional?: string[]; properties: Record<string, InputKind> };
  expectedResult: { httpStatus: number; requiredFields: string[]; successValue: boolean };
  x402: X402Pin;
};
export type PaidConfig = {
  name: string; recordVersion: string; configVersion: number; enabled: boolean;
  pins: Record<string, string>;
  providers: PaidProvider[];
  resources: PaidResource[];
  policy: {
    allowedTools: string[]; allowedHosts: string[]; allowedNetworks: string[]; allowedAssets: string[];
    allowedPayees: string[]; perCallCapAtomic: string; taskBudgetAtomic: string;
    approvalThresholdAtomic: string; maxCallsPerTask: number;
  };
  solana: { payer: string; commitment: "finalized"; rpcs: string[]; explorer: string };
  robinhood: { network: string; chainId: number; rpc: string; contract: string; method: string; environmentUuid: string; explorer: string };
  validators: { nodes: string[]; threshold: number; rpcs: string[]; nodesNote?: string };
};

const here = dirname(fileURLToPath(import.meta.url));
// src/paid -> repo root is 3 up; bundled dist/ -> 2 up.
export const PAID_ROOT = resolve(process.env.VEYA_PAID_ROOT || (basename(here) === "dist" ? join(here, "..", "..") : join(here, "..", "..", "..")));

/** Config shipped inside the npm package (no secrets; validator URLs come from VEYA_PAID_VALIDATOR_NODES). */
export const BUNDLED_PAID_CONFIG = join(here, ...(basename(here) === "dist" ? [".."] : ["..", ".."]), "config", "paid-calls.json");
/** VEYA_PAID_CONFIG, else <VEYA_PAID_ROOT>/config/paid-calls.json if present, else the bundled config. */
export function paidConfigPath(): string {
  if (process.env.VEYA_PAID_CONFIG) return process.env.VEYA_PAID_CONFIG;
  const rooted = join(PAID_ROOT, "config", "paid-calls.json");
  return existsSync(rooted) ? rooted : BUNDLED_PAID_CONFIG;
}

export function loadPaidConfig(path = paidConfigPath()): PaidConfig {
  const cfg = JSON.parse(readFileSync(path, "utf8")) as PaidConfig;
  // Deploy-time override: where the 3 validator nodes live (comma-separated base URLs).
  if (process.env.VEYA_PAID_VALIDATOR_NODES) cfg.validators.nodes = process.env.VEYA_PAID_VALIDATOR_NODES.split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  if (cfg.validators.threshold < 2 || cfg.validators.nodes.length < 3) throw new Error("CONFIG: need >=3 validators and threshold >=2 (set VEYA_PAID_VALIDATOR_NODES)");
  assertIndependentRpcs(cfg);
  if (cfg.solana.commitment !== "finalized") throw new Error("CONFIG: Solana commitment must be finalized");
  for (const r of cfg.resources) {
    const p = cfg.providers.find((x) => x.id === r.provider);
    if (!p) throw new Error(`CONFIG: resource ${r.id} has unknown provider ${r.provider}`);
    const kind = payerKind(cfg, r);
    if (kind !== "xpay-sdk" && kind !== "x402-exact") throw new Error(`CONFIG: resource ${r.id} has unknown payer ${kind}`);
    if (kind === "xpay-sdk" && !p.sdk) throw new Error(`CONFIG: provider ${p.id} uses xpay-sdk but has no sdk settings`);
    if (r.x402.scheme !== "exact") throw new Error(`CONFIG: resource ${r.id} must pin the exact scheme`);
  }
  return cfg;
}

export const providerOf = (cfg: PaidConfig, r: PaidResource) => cfg.providers.find((p) => p.id === r.provider)!;
/** Resource-level payer override, else the provider default. */
export const payerKind = (cfg: PaidConfig, r: PaidResource): PayerKind => r.payer ?? providerOf(cfg, r).payer;
/** Extra fee the payer path adds on top of the resource price (xPay SDK platform fee; 0 for standard x402). */
export function payerFee(cfg: PaidConfig, r: PaidResource): { amountAtomic: bigint; payTo?: string } {
  const p = providerOf(cfg, r);
  return payerKind(cfg, r) === "xpay-sdk" && p.sdk ? { amountAtomic: BigInt(p.sdk.platformFee.amountAtomic), payTo: p.sdk.platformFee.payTo } : { amountAtomic: 0n };
}

/** Provider = last two labels of the RPC host (publicnode.com, solana.com, ...). Each validator needs its own. */
export const rpcProvider = (url: string) => new URL(url).hostname.split(".").slice(-2).join(".");
export function assertIndependentRpcs(cfg: PaidConfig) {
  const r = cfg.validators.rpcs;
  if (r.length < cfg.validators.nodes.length) throw new Error("CONFIG: one Solana RPC per validator required");
  const providers = r.slice(0, cfg.validators.nodes.length).map(rpcProvider);
  if (new Set(providers).size !== providers.length) throw new Error(`CONFIG: validators share an RPC provider (${providers.join(", ")})`);
}
