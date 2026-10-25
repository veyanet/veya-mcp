/**
 * The only place a payer library is touched. Exposes exactly one capability: pay-and-call ONE
 * VEYA-authorized requirement, via either
 *  - "xpay-sdk":   the provider's xPay SDK, use() only, with its guardrails on; or
 *  - "x402-exact": the standard x402 `exact` scheme on Solana (official @x402 client libraries).
 * No do(), transfer, swap, trade, forClaude/forOpenAI/forGemini or xpay-mcp is ever imported or exposed.
 */
import { readFileSync } from "node:fs";
import { payerKind, providerOf, type PaidConfig, type PaidResource } from "./config.js";
import type { Requirement } from "./policy.js";

export type PaidCallResult = {
  data: unknown; status: number; amountPaid: string; txSig?: string;
  settlement?: { transaction: string; payer?: string; network: string; amount?: string; success?: boolean };
  platformFee?: { amount: number; txSig?: string; success: boolean; error?: string };
  free?: boolean;
};
export interface PaidCaller { payAndCall(resource: PaidResource, req: Requirement, body: unknown): Promise<PaidCallResult>; }

export class PinMismatchError extends Error {}

/** Where the Solana secret comes from: a key file path (operator self-host) or an in-memory source (caller's own key). */
export type SecretSource = string | (() => Uint8Array);
/** Fresh copy of the 64-byte secret each time; the caller zeroes it after use. */
export function readSecret(src: SecretSource): Uint8Array {
  return typeof src === "string" ? Uint8Array.from(JSON.parse(readFileSync(src, "utf8")) as number[]) : Uint8Array.from(src());
}

function sameReq(a: Requirement, b: Requirement) {
  return a.network === b.network && a.asset === b.asset && a.payTo === b.payTo && a.amount === b.amount && a.scheme === b.scheme;
}

/** Picks the payer path configured for each resource (provider default or resource override). */
export function createCaller(cfg: PaidConfig, keyPath: SecretSource, opts: { rpcUrl?: string; fetchImpl?: typeof fetch } = {}): PaidCaller {
  const sdk = createXpayCaller(cfg, keyPath, opts.rpcUrl);
  const std = createX402Caller(cfg, keyPath, opts);
  return { payAndCall: (resource, req, body) => (payerKind(cfg, resource) === "x402-exact" ? std : sdk).payAndCall(resource, req, body) };
}

/** xPay SDK caller. Secret key read from a file path inside the server process only. */
export function createXpayCaller(cfg: PaidConfig, keyPath: SecretSource, rpcUrl = cfg.solana.rpcs[0]): PaidCaller {
  return {
    async payAndCall(resource, req, body) {
      const secret = readSecret(keyPath);
      const xpay = await buildGuardedXpay(cfg, secret, req, rpcUrl, resource);
      secret.fill(0);
      const r = await xpay.use(
        { resource: resource.url, type: "http", method: resource.method, x402Version: resource.x402.x402Version, accepts: [req] } as never,
        { body },
      );
      return r as unknown as PaidCallResult;
    },
  };
}

/** Build the xPay client with guardrails ON and the VEYA pin installed at the signing boundary. Internal only. */
export async function buildGuardedXpay(cfg: PaidConfig, secret: Uint8Array, req: Requirement, rpcUrl = cfg.solana.rpcs[0], resource?: PaidResource) {
  const { createXPay, rawSolanaSigner } = await import("@xona-labs/xpay");
  const r = resource ?? cfg.resources.find((x) => payerKind(cfg, x) === "xpay-sdk");
  const guard = r ? providerOf(cfg, r).sdk?.guardrail : undefined;
  if (!guard) throw new PinMismatchError("VEYA_PIN: no xPay SDK guardrail configured for this provider");
  const xpay = createXPay({
    networks: ["solana"],
    signers: { solana: rawSolanaSigner({ secretKey: Uint8Array.from(secret), rpcUrl }) },
    guardrail: {
      maxPerTx: guard.maxPerTx,
      maxPerDay: guard.maxPerDay,
      allowedHosts: guard.allowedHosts,
      requireApprovalAbove: guard.requireApprovalAbove,
      onApprovalRequired: async () => false, // fail closed: no human approver configured
    },
  });
  // xPay calls guardrail.check right before signing; wrap it so any requirement other than
  // the VEYA-authorized one is refused even if xPay would pick another option.
  const g = xpay.guardrail as unknown as { check: (a: { resource: unknown; requirement: Requirement }) => Promise<void> };
  const orig = g.check.bind(g);
  g.check = async (a) => {
    if (!sameReq(a.requirement, req)) throw new PinMismatchError("VEYA_PIN: xPay picked a requirement that VEYA did not authorize");
    return orig(a);
  };
  return xpay;
}

/** Minimal shape of a standard x402 v2 payment payload (only what VEYA checks). */
export type X402Payload = { x402Version: number; accepted: Requirement; payload: unknown; resource?: unknown };
export type X402Deps = {
  rpcUrl?: string; fetchImpl?: typeof fetch;
  /** Test seam: build the signed payload for exactly one requirement. Default: official @x402 libraries. */
  buildPayload?: (secret: Uint8Array, paymentRequired: { x402Version: number; resource: { url: string; description: string; mimeType: string }; accepts: Requirement[] }, rpcUrl: string) => Promise<{ payload: X402Payload; headers: Record<string, string>; readSettle: (get: (n: string) => string | null) => unknown }>;
};

/** Default payload builder: @x402/core client + @x402/svm exact scheme, with only the authorized option offered. */
export async function buildX402Payload(secret: Uint8Array, paymentRequired: Parameters<NonNullable<X402Deps["buildPayload"]>>[1], rpcUrl: string) {
  const [{ x402Client, x402HTTPClient }, { ExactSvmScheme }, { createKeyPairSignerFromBytes }] = await Promise.all([
    import("@x402/core/client"), import("@x402/svm/exact/client"), import("@solana/kit"),
  ]);
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(secret));
  const core = new x402Client().register(paymentRequired.accepts[0].network as `${string}:${string}`, new ExactSvmScheme(signer, { rpcUrl }));
  const http = new x402HTTPClient(core);
  const payload = (await http.createPaymentPayload(paymentRequired as never)) as unknown as X402Payload;
  return { payload, headers: http.encodePaymentSignatureHeader(payload as never), readSettle: (get: (n: string) => string | null) => http.getPaymentSettleResponse(get) };
}

/**
 * Standard x402 `exact` caller (Solana). VEYA hands the library a PaymentRequired that contains only
 * the requirement VEYA authorized, checks the signed payload still matches it, sends ONE request
 * with the payment header and reads the settlement header. No payer platform fee on this path.
 */
export function createX402Caller(cfg: PaidConfig, keyPath: SecretSource, deps: X402Deps = {}): PaidCaller {
  const rpcUrl = deps.rpcUrl ?? cfg.solana.rpcs[0];
  const build = deps.buildPayload ?? buildX402Payload;
  return {
    async payAndCall(resource, req, body) {
      if (req.scheme !== "exact") throw new PinMismatchError(`VEYA_PIN: scheme ${req.scheme} is not exact`);
      const secret = readSecret(keyPath);
      let built: Awaited<ReturnType<NonNullable<X402Deps["buildPayload"]>>>;
      try {
        built = await build(secret, { x402Version: resource.x402.x402Version, resource: { url: resource.url, description: resource.description, mimeType: "application/json" }, accepts: [{ ...req, maxTimeoutSeconds: req.maxTimeoutSeconds ?? resource.x402.maxTimeoutSeconds }] }, rpcUrl);
      } catch (err) {
        throw new Error(`X402_NOT_SENT: could not build the payment payload: ${(err as Error).message}`);
      } finally { secret.fill(0); }
      if (!built.payload?.accepted || !sameReq(built.payload.accepted, req)) throw new PinMismatchError("VEYA_PIN: signed x402 payload does not match the requirement VEYA authorized");
      const res = await (deps.fetchImpl ?? fetch)(resource.url, {
        method: resource.method, headers: { "content-type": "application/json", ...built.headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
      });
      const text = await res.text();
      let data: unknown = text; try { data = JSON.parse(text); } catch { /* keep text */ }
      let settle: { success?: boolean; transaction?: string; network?: string; payer?: string; amount?: string } | undefined;
      try { settle = built.readSettle((n) => res.headers.get(n)) as typeof settle; } catch { settle = undefined; }
      if (!settle?.transaction) throw new Error(`X402_NO_SETTLEMENT: HTTP ${res.status}; no settlement header (payment status unknown)`);
      return {
        data, status: res.status, amountPaid: req.amount ?? "0", txSig: settle.transaction,
        settlement: { transaction: settle.transaction, payer: settle.payer, network: settle.network ?? req.network, amount: settle.amount, success: settle.success },
      };
    },
  };
}
