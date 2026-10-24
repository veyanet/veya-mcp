import { payerFee, type PaidConfig, type PaidResource } from "./config.js";

export type Requirement = { scheme: string; network: string; asset: string; payTo: string; amount?: string; maxTimeoutSeconds?: number; extra?: Record<string, unknown> };
export type Quote = { x402Version: number; accepts: Requirement[]; resourceUrl?: string };
export type GateInput = {
  tool: string; resourceUrl: string; resourceId: string; quote: Quote; taskBudgetAtomic: bigint;
};
export type GateResult =
  | { allow: true; requirement: Requirement; resource: PaidResource; callCostAtomic: bigint; checks: string[] }
  | { allow: false; code: string; reason: string; checks: string[] };

/** Pure policy gate. Runs before any payer is constructed for a call. */
export function evaluatePolicy(cfg: PaidConfig, i: GateInput): GateResult {
  const checks: string[] = [];
  const deny = (code: string, reason: string): GateResult => ({ allow: false, code, reason, checks });
  if (!cfg.policy.allowedTools.includes(i.tool)) return deny("TOOL_NOT_ALLOWED", `tool ${i.tool} not in allowlist`);
  checks.push("tool");
  let host: string;
  try { const u = new URL(i.resourceUrl); if (u.protocol !== "https:") return deny("HOST_NOT_ALLOWED", "https only"); host = u.hostname; } catch { return deny("HOST_NOT_ALLOWED", "bad url"); }
  if (!cfg.policy.allowedHosts.includes(host)) return deny("HOST_NOT_ALLOWED", `host ${host} not in allowlist`);
  checks.push("host");
  const resource = cfg.resources.find((r) => r.id === i.resourceId);
  if (!resource || resource.url !== i.resourceUrl) return deny("RESOURCE_NOT_ALLOWED", `resource ${i.resourceId} / ${i.resourceUrl} not pinned`);
  checks.push("resource");
  if (i.quote.x402Version !== resource.x402.x402Version) return deny("CHALLENGE_CHANGED", `x402Version ${i.quote.x402Version} != pinned ${resource.x402.x402Version}`);
  if (!i.quote.accepts?.length) return deny("CHALLENGE_CHANGED", "no accepts[] in challenge");
  // Every option the server offers must be inside policy; a payer library may pick any offered option.
  for (const a of i.quote.accepts) {
    if (!cfg.policy.allowedNetworks.includes(a.network)) return deny("NETWORK_NOT_ALLOWED", `network ${a.network}`);
    if (!cfg.policy.allowedAssets.includes(a.asset)) return deny("ASSET_NOT_ALLOWED", `asset ${a.asset}`);
    if (!cfg.policy.allowedPayees.includes(a.payTo)) return deny("PAYEE_NOT_ALLOWED", `payTo ${a.payTo}`);
    if (a.scheme !== resource.x402.scheme) return deny("CHALLENGE_CHANGED", `scheme ${a.scheme}`);
    if (a.amount === undefined || !/^\d+$/.test(a.amount)) return deny("CHALLENGE_CHANGED", "amount missing");
  }
  checks.push("network", "asset", "payee");
  if (i.quote.accepts.length !== 1) return deny("CHALLENGE_CHANGED", `expected 1 option, got ${i.quote.accepts.length}`);
  const req = i.quote.accepts[0];
  const amount = BigInt(req.amount!);
  if (amount > BigInt(cfg.policy.perCallCapAtomic)) return deny("OVER_PER_CALL_CAP", `price ${amount} > cap ${cfg.policy.perCallCapAtomic}`);
  if (req.amount !== resource.x402.amount) return deny("CHALLENGE_CHANGED", `price ${req.amount} != pinned ${resource.x402.amount}`);
  if (req.extra?.feePayer !== resource.x402.feePayer) return deny("CHALLENGE_CHANGED", `feePayer changed`);
  checks.push("per_call_cap", "pinned_challenge");
  const callCost = amount + payerFee(cfg, resource).amountAtomic;
  if (callCost > BigInt(cfg.policy.approvalThresholdAtomic)) return deny("APPROVAL_REQUIRED", `cost ${callCost} > approval threshold ${cfg.policy.approvalThresholdAtomic}; no approver configured`);
  checks.push("approval_threshold");
  if (i.taskBudgetAtomic > BigInt(cfg.policy.taskBudgetAtomic)) return deny("OVER_TASK_BUDGET", `requested task budget ${i.taskBudgetAtomic} > policy max ${cfg.policy.taskBudgetAtomic}`);
  if (callCost > i.taskBudgetAtomic) return deny("OVER_TASK_BUDGET", `call cost ${callCost} (price + payer fee) > task budget ${i.taskBudgetAtomic}`);
  checks.push("task_budget_static");
  return { allow: true, requirement: req, resource, callCostAtomic: callCost, checks };
}

/** Unpaid 402 probe. Free: no payment header is ever sent. */
export async function probeChallenge(url: string, body: unknown, fetchImpl: typeof fetch = fetch, timeoutMs = 15000): Promise<Quote> {
  const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (res.status !== 402) throw new Error(`PROBE: expected 402, got ${res.status}`);
  const j = (await res.json()) as { x402Version: number; accepts: Requirement[]; resource?: { url?: string } };
  return { x402Version: j.x402Version, accepts: j.accepts ?? [], resourceUrl: j.resource?.url };
}

const KIND: Record<string, RegExp> = {
  "solana-address": /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  slug: /^[a-z0-9][a-z0-9-]{0,63}$/,
  string: /^[^\u0000-\u001f]{1,200}$/,
};
/** Strict input check against the resource's declared fields. Unknown fields are refused. */
export function validateInput(resource: PaidResource, input: Record<string, unknown>): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "input must be an object";
  const allowed = [...resource.input.required, ...(resource.input.optional ?? [])];
  for (const k of resource.input.required) if (typeof input[k] !== "string") return `missing ${k}`;
  for (const k of Object.keys(input)) {
    if (!allowed.includes(k)) return `unexpected field ${k}`;
    const v = input[k]; const kind = resource.input.properties[k] ?? "string";
    if (typeof v !== "string" || !(KIND[kind] ?? KIND.string).test(v)) return `${k} is not a valid ${kind}`;
  }
  return null;
}
