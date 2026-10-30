/**
 * Agent-facing surface. Exactly three tools:
 *  - veya_paid_discover  (read-only; unpaid 402 quote + policy preview; cannot pay)
 *  - veya_paid_call      (one metered call, only through the VEYA policy gate)
 *  - veya_paid_run       (read run status / resume verification and anchoring; never pays)
 * veya_paid_call takes the caller's OWN Solana key (solanaPrivateKey) for that one call. It is used in memory
 * only, never stored, logged or echoed, and zeroed after the call. No transfer/swap/trade/do() tool is registered.
 */
import { z } from "zod";
import { join } from "node:path";
import { readFileSync, accessSync, statSync, constants as fsConstants } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadPaidConfig, payerKind, payerFee, PAID_ROOT, type PaidConfig } from "./config.js";
import { PaidCallGuard, PAYER_REQUIRED_REASON, ROBINHOOD_KEY_REQUIRED_REASON, refused, type PaidCallResponse } from "./pipeline.js";
import type { RunRecord } from "./state.js";
import { Wallet } from "ethers";
import { loadConfig, type McpServiceConfig } from "../config.js";
import { apiRequest, safeRequestMessage } from "../api.js";
import { isProductApiKey } from "../credentials.js";
import { anchorPreflight } from "./anchor.js";
import { parseRobinhoodKey, RobinhoodKeyError } from "./robinhoodKey.js";
import { parseSponsoredKeys, SponsorLedger, type SponsoredEntry } from "./sponsored.js";

export const API_KEY_REQUIRED_REASON = "API_KEY_REQUIRED: pass your VEYA product API key (veya_dev_... or veya_live_...) in the apiKey argument. Create one at https://app.veyanet.tech (System -> API Keys). Nothing was checked, signed or spent.";
import { createCaller } from "./payer.js";
import { createAnchorer } from "./anchor.js";
import { evaluatePolicy, probeChallenge } from "./policy.js";
import { addressFromKeyFile, parsePayerKey, PayerKeyError, type ParsedPayer } from "./payerKey.js";

export const PAID_TOOL_NAMES = ["veya_paid_discover", "veya_paid_call", "veya_paid_run"] as const;

export function buildGuardFromEnv(cfg: PaidConfig = loadPaidConfig()): PaidCallGuard {
  const keyPath = process.env.VEYA_PAID_SOLANA_KEY_PATH;
  // Separate env from the MCP relayer so no other MCP tool gains write power.
  const anchorKeyPath = process.env.VEYA_PAID_ANCHOR_KEY_PATH;
  return new PaidCallGuard({
    cfg, stateDir: process.env.VEYA_PAID_STATE_DIR || join(PAID_ROOT, "state"), receiptsDir: process.env.VEYA_PAID_RECEIPTS_DIR || join(PAID_ROOT, "receipts"),
    caller: (secret) => {
      if (secret) { const copy = Uint8Array.from(secret); return createCaller(cfg, () => copy); }
      if (!keyPath) throw new Error("PAYER_NOT_CONFIGURED: no payer key for this call");
      return createCaller(cfg, keyPath);
    },
    operatorPayer: () => (keyPath ? addressFromKeyFile(keyPath) : undefined),
    anchorConfigured: () => anchorKeyReadable(anchorKeyPath),
    anchorer: (run, key) => {
      const env = ((run?.evidence as any)?.environmentUuid as string | undefined) ?? cfg.robinhood.environmentUuid;
      if (key) return createAnchorer(cfg, key, env);
      // Server-configured key only for runs not made in caller-key mode.
      if ((run?.evidence as any)?.mode === "partner") throw new Error("ROBINHOOD_KEY_REQUIRED: pass robinhoodPrivateKey to resume this run.");
      if (!anchorKeyPath) throw new Error("ANCHOR_NOT_CONFIGURED");
      return createAnchorer(cfg, readFileSync(anchorKeyPath, "utf8").trim(), env);
    },
  });
}

/** True when the anchor key file is set and readable. Never returns or logs the path or contents. */
export function anchorKeyReadable(path: string | undefined): boolean {
  if (!path) return false;
  try { accessSync(path, fsConstants.R_OK); return statSync(path).isFile(); } catch { return false; }
}

/**
 * One guard (and so one in-memory ledger) per process. The HTTP transport builds a new McpServer per
 * request; sharing the guard keeps budget reservation and idempotency atomic across parallel requests.
 */
let shared: { guard: PaidCallGuard; cfg: PaidConfig } | undefined;
export function sharedGuard(): { guard: PaidCallGuard; cfg: PaidConfig } {
  if (!shared) { const cfg = loadPaidConfig(); shared = { guard: buildGuardFromEnv(cfg), cfg }; }
  return shared;
}

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }] });

/** Amount limits from the policy config (USDC atomic units, 6 decimals). */
export function amountLimits(cfg: PaidConfig) {
  const usdc = (a: string) => `${(Number(a) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} USDC`;
  const p = cfg.policy;
  return {
    unit: "USDC atomic units (6 decimals, 10000 = 0.01 USDC)",
    perCallCapAtomic: p.perCallCapAtomic, perCallCap: usdc(p.perCallCapAtomic),
    perCallCapNote: "Largest provider quote a single call may accept.",
    perCallTotalMaxAtomic: p.approvalThresholdAtomic, perCallTotalMax: usdc(p.approvalThresholdAtomic),
    perCallTotalMaxNote: "Largest total one call may charge to the task budget (provider quote plus any provider fee).",
    taskBudgetMaxAtomic: p.taskBudgetAtomic, taskBudgetMax: usdc(p.taskBudgetAtomic),
    defaultTaskBudgetAtomic: p.taskBudgetAtomic, defaultTaskBudget: usdc(p.taskBudgetAtomic),
    taskBudgetNote: "taskBudgetAtomic is optional. When omitted the default is used; a larger value is refused with OVER_TASK_BUDGET.",
    maxCallsPerTask: p.maxCallsPerTask,
  };
}

/** Provider quote and total charged to the task budget for one resource, with a short explanation. */
export function resourceAmounts(cfg: PaidConfig, r: PaidConfig["resources"][number]) {
  const fee = payerFee(cfg, r).amountAtomic; const quote = BigInt(r.x402.amount);
  return {
    providerQuoteAtomic: quote.toString(), providerFeeAtomic: fee.toString(), totalChargedAtomic: (quote + fee).toString(),
    note: fee > 0n
      ? `Total includes the provider's platform fee of ${fee} atomic, which the provider's SDK charges as a second USDC transfer on each call. Both transfers count against your task budget.`
      : "Total equals the provider quote. One USDC transfer per call.",
  };
}

/** Kill switch wording shared by describe, /health and discover. */
export const KILL_SWITCH_NOTE = "Operator-only. When it is on, every veya_paid_call is refused with EMERGENCY_DISABLED before anything is checked, signed or sent. Callers cannot turn it on or off.";
export const RECEIPT_NOTE = "Receipt links are public proof: anyone with the link can read them. They hold the run state, policy decision, payer address, Solana signature, validator count, commitment and Robinhood Chain transaction. They never hold keys, the apiKey, your input or the resource output.";
export const RUNS_NOTE = "veya_paid_run is private to the account of the apiKey you pass. Another key cannot list or read your runs.";

/** Public status for veya_describe and /health. Never includes keys or key paths. */
export function paidCallsStatus(): Record<string, unknown> {
  if (process.env.VEYA_PAID_CALLS !== "1") return { enabled: false };
  try {
    const { guard, cfg } = sharedGuard();
    const off = guard.disabled();
    return {
      enabled: !off, killSwitch: off ? "on" : "off", killSwitchNote: KILL_SWITCH_NOTE, tools: [...PAID_TOOL_NAMES],
      requires: ["apiKey", "solanaPrivateKey", "robinhoodPrivateKey"],
      payer: "your own wallets: Solana pays USDC, Robinhood Chain signs the record and pays its gas (keys used for one call, never stored)",
      runsSavedTo: "your VEYA account (veya_paid_run lists them)", runsPrivacy: RUNS_NOTE,
      limits: amountLimits(cfg),
      resources: cfg.resources.map((r) => r.id), paymentNetwork: "Solana mainnet (USDC)", recordNetwork: cfg.robinhood.network,
      validators: `${cfg.validators.threshold} of ${cfg.validators.nodes.length}`, receipts: "/receipts/paid/<runId>", receiptsNote: RECEIPT_NOTE,
    };
  } catch (e) { return { enabled: false, error: "metered call config not loaded" }; }
}

const solanaKeyBase = z.string().max(1024)
  .describe("Your own Solana wallet secret key (base58, or a JSON array of 64 numbers). It pays the USDC for this one call from your wallet. Used in memory only, never stored, logged or returned.");
const robinhoodKeyBase = z.string().max(100)
  .describe("Your own Robinhood Chain wallet private key (0x + 64 hex). It signs the VEYA record (storeCommitment on Veya.sol) and pays its small ETH gas, so the record comes from your address. Used in memory only, never stored, logged or returned.");
const apiKeyArg = z.string().min(10).max(200)
  .describe("Your VEYA product API key (veya_dev_... or veya_live_...) from https://app.veyanet.tech (System -> API Keys). Every run is saved to this key's VEYA account.");

/** Backend access for paid runs. Injected so tests can run without the live API. */
export type AccountApi = {
  account(apiKey: string): Promise<{ accountId: string; wallet: string }>;
  saveRun(apiKey: string, run: Record<string, unknown>): Promise<void>;
  getRun(apiKey: string, runId: string): Promise<unknown | undefined>;
  listRuns(apiKey: string): Promise<unknown>;
};

export class AccountError extends Error {}

export function httpAccountApi(svc: McpServiceConfig = loadConfig()): AccountApi {
  const call = async (apiKey: string, path: string, method = "GET", body?: unknown) => {
    try { return await apiRequest(svc, path, { apiKey, method, body }); }
    catch (e) { throw new AccountError(`API_UNAVAILABLE: the VEYA account API could not be reached (${safeRequestMessage(e)}). Nothing was signed or spent.`); }
  };
  return {
    async account(apiKey) {
      if (!isProductApiKey(apiKey)) throw new AccountError("API_KEY_INVALID: apiKey must be a VEYA product API key (veya_dev_... or veya_live_...). Create one at https://app.veyanet.tech (System -> API Keys). Nothing was signed or spent.");
      const r = await call(apiKey, "/v1/account");
      const b = r.body as { wallet?: string; accountId?: string; isGuest?: boolean };
      if (r.httpStatus === 401 || r.httpStatus === 403) throw new AccountError("API_KEY_INVALID: this apiKey was rejected (unknown or revoked). Nothing was signed or spent.");
      if (r.httpStatus >= 400 || !b?.accountId || !b.wallet) throw new AccountError(`API_UNAVAILABLE: the VEYA account API answered HTTP ${r.httpStatus}. Nothing was signed or spent.`);
      if (b.isGuest) throw new AccountError("API_KEY_INVALID: guest sessions cannot make metered calls. Use a product API key. Nothing was signed or spent.");
      return { accountId: b.accountId, wallet: b.wallet };
    },
    async saveRun(apiKey, run) {
      const r = await call(apiKey, "/v1/paid-runs", "POST", run);
      if (r.httpStatus >= 400) throw new AccountError(`ACCOUNT_SAVE_FAILED: HTTP ${r.httpStatus}`);
    },
    async getRun(apiKey, runId) {
      const r = await call(apiKey, `/v1/paid-runs/${encodeURIComponent(runId)}`);
      return r.httpStatus === 200 ? r.body : undefined;
    },
    async listRuns(apiKey) {
      const r = await call(apiKey, "/v1/paid-runs");
      if (r.httpStatus >= 400) throw new AccountError(`ACCOUNT_READ_FAILED: HTTP ${r.httpStatus}`);
      return r.body;
    },
  };
}

/** Key id from a product API key (veya_<tier>_<id>_<secret>). Only used after the backend accepted the key. */
export function apiKeyId(apiKey: string): string | undefined {
  const m = /^(?:veya|vya)_(?:dev|live)_([0-9a-fA-F-]{36})_/.exec(apiKey.trim());
  return m ? m[1].toLowerCase() : undefined;
}

/** What the backend stores for a run. Addresses, signatures and hashes only, never keys. */
export function accountRecord(r: RunRecord, view: PaidCallResponse): Record<string, unknown> {
  const e = r.evidence as any; const d = r.decision as any;
  const sigs = [e.paymentSig, e.feeSig].filter((x): x is string => typeof x === "string" && x.length > 0);
  const out: Record<string, unknown> = {
    runId: r.runId, taskId: String(e.taskLabel ?? r.taskId).slice(0, 80), state: r.state, resourceId: r.resourceId,
    amountAtomic: r.spentAtomic !== "0" ? r.spentAtomic : d?.callCostAtomic ?? "0", asset: d?.requirement?.asset,
    solanaPayer: e.payerAddress, solanaSignatures: sigs,
    validators: view.validators ? { agreed: view.validators.agreed, required: view.validators.required, total: view.validators.total } : null,
    commitment: e.commitment, environmentUuid: e.environmentUuid, robinhoodFrom: e.robinhoodFrom, robinhoodTx: e.veyaTx || undefined,
    receiptUrl: view.receipt && /^https?:\/\//.test(view.receipt) ? view.receipt : undefined,
    reason: view.reason?.slice(0, 600), runCreatedAt: r.history[0]?.at,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === "") delete out[k];
  return out;
}

export type PaidToolDeps = { accounts?: AccountApi; sponsors?: Map<string, SponsoredEntry>; sponsorLedger?: SponsorLedger;
  operatorAnchorAddress?: () => string | undefined; preflight?: (address: string, environmentUuid: string, who: "your" | "the") => Promise<string | null> };

const blocked = (state: string, reason: string) => json(refused(state, reason));

export function registerPaidCallTools(server: McpServer, guard: PaidCallGuard = sharedGuard().guard, cfg: PaidConfig = sharedGuard().cfg, deps: PaidToolDeps = {}): void {
  const accounts = deps.accounts ?? httpAccountApi();
  const sponsors = deps.sponsors ?? sponsoredKeys();
  const sponsorLedger = deps.sponsorLedger ?? sharedSponsorLedger();
  const preflight = deps.preflight ?? ((addr, env, who) => anchorPreflight(cfg, addr, env, who));
  const operatorAnchor = deps.operatorAnchorAddress ?? operatorAnchorAddress;
  // Schema requirement for wallet keys depends on server configuration.
  const keysOptional = sponsors.size > 0;
  const solanaArg = keysOptional ? solanaKeyBase.optional() : solanaKeyBase;
  const robinhoodArg = keysOptional ? robinhoodKeyBase.optional() : robinhoodKeyBase;

  const save = async (apiKey: string, runId: string | undefined, view: PaidCallResponse) => {
    const r = runId ? guard.ledger.run(runId) : undefined;
    if (!r || !(r.evidence as any).accountId) return { ...view };
    try { await accounts.saveRun(apiKey, accountRecord(r, view)); return { ...view, account: { saved: true } }; }
    catch (e) { return { ...view, account: { saved: false, reason: (e as Error).message.slice(0, 200), retry: "Read the run with veya_paid_run to save it again." } }; }
  };

  server.tool("veya_paid_discover", "Read-only. List the resources this VEYA policy allows, with their input fields, a live quote (nothing is sent), the provider quote and total charged to your task budget for each resource, the per-call cap, task budget maximum and default, and a policy preview. Cannot pay.",
    {},
    async () => {
      const out = [];
      for (const r of cfg.resources) {
        try {
          const quote = await probeChallenge(r.url, {});
          const g = evaluatePolicy(cfg, { tool: "veya_paid_call", resourceUrl: r.url, resourceId: r.id, quote, taskBudgetAtomic: BigInt(cfg.policy.taskBudgetAtomic) });
          out.push({ id: r.id, provider: r.provider, payer: payerKind(cfg, r), description: r.description, input: r.input, amounts: resourceAmounts(cfg, r), quote, policyPreview: g.allow ? { allow: true, callCostAtomic: g.callCostAtomic.toString() } : { allow: false, code: g.code, reason: g.reason } });
        } catch (e) { out.push({ id: r.id, amounts: resourceAmounts(cfg, r), error: (e as Error).message }); }
      }
      return json({ disabled: guard.disabled(), killSwitch: guard.disabled() ? "on" : "off", killSwitchNote: KILL_SWITCH_NOTE, limits: amountLimits(cfg), receiptsNote: RECEIPT_NOTE, runsPrivacy: RUNS_NOTE, requires: ["apiKey", "solanaPrivateKey (USDC)", "robinhoodPrivateKey (ETH gas for the record)"], defaultEnvironmentUuid: cfg.robinhood.environmentUuid, resources: out });
    });

  server.tool("veya_paid_call", "Run one metered x402 resource call through the VEYA policy gate. Needs your VEYA apiKey, your Solana key (solanaPrivateKey, pays the USDC) and your Robinhood Chain key (robinhoodPrivateKey, signs the VEYA record and pays its ETH gas). Keys are used in memory for this call only and never stored. Before anything is signed VEYA checks the apiKey, both keys, your USDC and ETH balances, and the policy (tool, host, resource, network, asset, payee, per-call cap, task budget, input). It then pays, verifies the Solana payment at finalized, runs a 2-of-3 validator check, records a commitment on Robinhood Chain from your address and saves the run to your VEYA account. Every refusal returns decision blocked, a stable code and payment: null. The kill switch is operator-only; callers cannot change it. Allow at least 120 s for the tool call timeout.",
    {
      apiKey: apiKeyArg,
      taskId: z.string().min(1).max(80).describe("Your task id. Calls with the same taskId share one task budget (per VEYA account)."),
      idempotencyKey: z.string().min(8).max(120).describe("Unique per intended payment (per VEYA account). Repeating it returns the same run and never pays again; use a new key for a new payment."),
      resourceId: z.string().optional().describe("A resource id from veya_paid_discover, e.g. tokens.asset-risk-summary."),
      input: z.record(z.string()).describe("Input fields for the resource, exactly as listed by veya_paid_discover (string values only)."),
      taskBudgetAtomic: z.string().regex(/^\d+$/).optional().describe("Optional task budget in USDC atomic units (6 decimals, 10000 = 0.01 USDC). Defaults to the policy budget; cannot exceed the policy maximum."),
      url: z.string().optional().describe("Optional. Normally omit it and use resourceId; any URL outside the allowlist is blocked before payment."),
      environmentUuid: z.string().regex(/^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/).optional().describe("Optional VEYA environment on Veya.sol to record under (yours, from veya_register_environment). Defaults to the VEYA metered-call environment shown by veya_paid_discover."),
      solanaPrivateKey: solanaArg,
      robinhoodPrivateKey: robinhoodArg,
    },
    async ({ apiKey, taskId, idempotencyKey, resourceId, input, taskBudgetAtomic, url, environmentUuid, solanaPrivateKey, robinhoodPrivateKey }) => {
      const off = guard.disabled();
      if (off) return blocked("disabled", "EMERGENCY_DISABLED: metered calls are switched off on this server by the operator. Nothing was checked, signed or spent.");
      let payer: ParsedPayer | undefined; let rh: { key: string; address: string } | undefined;
      try {
        if (solanaPrivateKey) payer = await parsePayerKey(solanaPrivateKey);
        if (robinhoodPrivateKey) rh = parseRobinhoodKey(robinhoodPrivateKey);
      } catch (e) {
        payer?.secret.fill(0);
        // Fixed messages only: a key never appears in an error.
        const m = e instanceof PayerKeyError || e instanceof RobinhoodKeyError ? e.message : "KEY_INVALID";
        return blocked(m.startsWith("ROBINHOOD") ? "robinhood_key_invalid" : "solana_key_invalid", m + " Nothing was checked, signed or spent.");
      }
      try {
        let acct: { accountId: string };
        try { acct = await accounts.account(apiKey); }
        catch (e) { return blocked("api_key_invalid", e instanceof AccountError ? e.message : "API_UNAVAILABLE: account check failed. Nothing was signed or spent."); }
        const keyId = apiKeyId(apiKey);
        const sponsor = !payer && !rh && keyId ? sponsors.get(keyId) : undefined;
        const env = environmentUuid ? normUuid(environmentUuid) : cfg.robinhood.environmentUuid;
        const owner = { accountId: acct.accountId, apiKeyId: keyId };
        const scopedIdem = `${acct.accountId}:${idempotencyKey}`;
        if (!sponsor) {
          if (!payer) return blocked("payer_required", PAYER_REQUIRED_REASON);
          if (!rh) return blocked("robinhood_key_required", ROBINHOOD_KEY_REQUIRED_REASON);
          const out = await guard.call({ taskId, idempotencyKey, input, taskBudgetAtomic, resourceId, url, payer, mode: "partner", owner, anchorKey: rh.key, robinhoodFrom: rh.address, environmentUuid: env,
            preflight: () => preflight(rh!.address, env, "your") });
          return json(await save(apiKey, out.runId, out));
        }
        // Server-configured path, within the per-key limit.
        const opAnchor = operatorAnchor();
        if (!guard.operatorPayerAddress() || !opAnchor) return blocked("payer_required", PAYER_REQUIRED_REASON);
        const replay = !!guard.ledger.runByIdem(scopedIdem);
        const res = cfg.resources.find((r) => r.id === (resourceId ?? cfg.resources[0].id));
        const hold = replay || !res ? 0n : BigInt(res.x402.amount) + payerFee(cfg, res).amountAtomic;
        if (!replay && res) { const ok = sponsorLedger.reserve(sponsor, hold); if (!ok.ok) return blocked("key_limit", ok.reason); }
        let spent = 0n;
        try {
          const out = await guard.call({ taskId, idempotencyKey, input, taskBudgetAtomic, resourceId, url, mode: "sponsored", owner, robinhoodFrom: opAnchor, environmentUuid: env,
            preflight: () => preflight(opAnchor, env, "the") });
          if (!out.replay && out.runId) spent = BigInt(guard.ledger.run(out.runId)?.spentAtomic ?? "0");
          return json(await save(apiKey, out.runId, out));
        } finally { if (hold > 0n) sponsorLedger.settle(sponsor.keyId, hold, spent); }
      } finally { payer?.secret.fill(0); payer = undefined; rh = undefined; }
    });

  server.tool("veya_paid_run", "Read your VEYA runs. Private to the account of the apiKey you pass; another key cannot read them. With runId: one run (state, payment, validators, Robinhood record, receipt). Without runId: the runs saved to your VEYA account. With resume=true: retries Solana verification, the 2-of-3 validator check or the Robinhood record for an unfinished run; pass robinhoodPrivateKey to sign the record. Never pays.",
    { apiKey: apiKeyArg, runId: z.string().max(80).optional().describe("Run id returned by veya_paid_call. Omit to list your runs."),
      resume: z.boolean().optional().describe("Retry the unfinished steps of this run. Never pays again."),
      robinhoodPrivateKey: robinhoodKeyBase.optional() },
    async ({ apiKey, runId, resume, robinhoodPrivateKey }) => {
      let rh: { key: string; address: string } | undefined;
      try { if (robinhoodPrivateKey) rh = parseRobinhoodKey(robinhoodPrivateKey); }
      catch (e) { return blocked("robinhood_key_invalid", (e instanceof RobinhoodKeyError ? e.message : "ROBINHOOD_KEY_INVALID") + " Nothing was signed or spent."); }
      let acct: { accountId: string };
      try { acct = await accounts.account(apiKey); }
      catch (e) { return blocked("api_key_invalid", e instanceof AccountError ? e.message : "API_UNAVAILABLE"); }
      try {
        if (!runId) return json(await accounts.listRuns(apiKey));
        const r = guard.ledger.run(runId);
        const owner = (r?.evidence as any)?.accountId as string | undefined;
        if (!r || (owner && owner !== acct.accountId)) {
          const saved = await accounts.getRun(apiKey, runId).catch(() => undefined);
          return json(saved ? { source: "account", run: saved } : { error: "unknown run" });
        }
        if (!resume) return json(await save(apiKey, runId, guard.view(r)));
        if (owner && (r.evidence as any).mode === "partner" && r.state === "commit_failed" && rh) {
          const pf = await preflight(rh.address, (r.evidence as any).environmentUuid ?? cfg.robinhood.environmentUuid, "your").catch((e) => `PREFLIGHT_UNAVAILABLE: ${(e as Error).message.slice(0, 120)}`);
          if (pf) return json({ ...guard.view(r), reason: pf });
          guard.ledger.update(runId, { evidence: { ...r.evidence, robinhoodFrom: rh.address } });
        }
        const out = r.state === "resource_error" ? await guard.reconcile(runId) : await guard.resume(runId, owner && (r.evidence as any).mode === "partner" ? rh?.key : undefined);
        return json(await save(apiKey, runId, out));
      } finally { rh = undefined; }
    });
  enforceStrictPaidArgs(server, !keysOptional, () => guard.disabled());
}

const normUuid = (u: string) => { const h = u.replace(/-/g, "").toLowerCase(); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

let sponsorCache: Map<string, SponsoredEntry> | undefined;
export function sponsoredKeys(): Map<string, SponsoredEntry> { return (sponsorCache ??= parseSponsoredKeys()); }
let ledgerCache: SponsorLedger | undefined;
function sharedSponsorLedger(): SponsorLedger { return (ledgerCache ??= new SponsorLedger(process.env.VEYA_PAID_STATE_DIR || join(PAID_ROOT, "state"))); }
/** Address of the operator Robinhood key, or undefined. Never returns the key. */
export function operatorAnchorAddress(): string | undefined {
  const p = process.env.VEYA_PAID_ANCHOR_KEY_PATH;
  if (!anchorKeyReadable(p)) return undefined;
  try { return new Wallet(readFileSync(p!, "utf8").trim()).address; } catch { return undefined; }
}

/** Argument names each paid tool accepts (matches additionalProperties:false in tools/list). */
export const PAID_TOOL_ARGS: Record<string, readonly string[]> = {
  veya_paid_discover: [],
  veya_paid_call: ["apiKey", "taskId", "idempotencyKey", "resourceId", "input", "taskBudgetAtomic", "url", "environmentUuid", "solanaPrivateKey", "robinhoodPrivateKey"],
  veya_paid_run: ["apiKey", "runId", "resume", "robinhoodPrivateKey"],
};

/** Unknown-argument check for a paid tool call. Returns a fixed message; never echoes argument names or values. */
export function unknownPaidArgs(tool: string, args: unknown): string | null {
  const allowed = PAID_TOOL_ARGS[tool]; if (!allowed) return null;
  if (args === undefined || args === null) return null;
  if (typeof args !== "object" || Array.isArray(args)) return "INPUT_INVALID: arguments must be an object.";
  const extra = Object.keys(args).filter((k) => !allowed.includes(k)).length;
  return extra ? `INPUT_INVALID: ${extra} unknown argument(s). Allowed: ${allowed.join(", ") || "none"}. Nothing was checked, signed or spent.` : null;
}

/**
 * The MCP SDK strips unknown keys before a handler runs, so a misplaced field (for example a key under the wrong
 * name) would be silently ignored. Wrap tools/call so veya_paid_* reject unknown arguments up front.
 */
function enforceStrictPaidArgs(server: McpServer, keyRequired: boolean, killSwitchOn: () => string | null = () => null): void {
  const proto = server.server as unknown as { _requestHandlers?: Map<string, (req: any, extra: any) => Promise<unknown>> };
  const handlers = proto._requestHandlers; const inner = handlers?.get("tools/call");
  if (!handlers || !inner || (inner as any).__veyaStrict) return;
  const wrapped = async (req: any, extra: any) => {
    const bad = unknownPaidArgs(req?.params?.name, req?.params?.arguments);
    if (bad) return { content: [{ type: "text", text: JSON.stringify(refused("input_invalid", bad), null, 2) }], isError: true };
    // Clear answers instead of the SDK's generic schema error when a required credential is missing.
    const n = req?.params?.name; const a = req?.params?.arguments ?? {};
    const miss = (state: string, reason: string) => ({ content: [{ type: "text", text: JSON.stringify(refused(state, reason), null, 2) }] });
    if (n === "veya_paid_call" && killSwitchOn()) return miss("disabled", "EMERGENCY_DISABLED: metered calls are switched off on this server by the operator. Nothing was checked, signed or spent.");
    if ((n === "veya_paid_call" || n === "veya_paid_run") && !a.apiKey) return miss("api_key_required", API_KEY_REQUIRED_REASON);
    if (n === "veya_paid_call" && (a.input === undefined || a.input === null)) return miss("input_invalid", "INPUT_INVALID: input is required. Pass the fields listed by veya_paid_discover. Nothing was checked, signed or spent.");
    if (keyRequired && n === "veya_paid_call" && !a.solanaPrivateKey) return miss("payer_required", PAYER_REQUIRED_REASON);
    if (keyRequired && n === "veya_paid_call" && !a.robinhoodPrivateKey) return miss("robinhood_key_required", ROBINHOOD_KEY_REQUIRED_REASON);
    const res: any = await inner(req, extra);
    // Schema errors from the SDK become a normal refusal with a code and payment: null (field names only, never values).
    const t = res?.isError && n in PAID_TOOL_ARGS ? String(res?.content?.[0]?.text ?? "") : "";
    if (/Input validation error/.test(t)) {
      const fields = [...t.matchAll(/ at ([A-Za-z0-9_.]+)/g)].map((m) => m[1]).filter((f, i, all) => all.indexOf(f) === i).slice(0, 10);
      return { ...miss("input_invalid", `INPUT_INVALID: arguments do not match the tool schema${fields.length ? ` (${fields.join(", ")})` : ""}. Nothing was checked, signed or spent.`), isError: true };
    }
    return res;
  };
  (wrapped as any).__veyaStrict = true;
  handlers.set("tools/call", wrapped);
  // List every veya_paid_* schema as closed (additionalProperties: false), including the no-argument discover tool.
  const list = handlers.get("tools/list");
  if (list && !(list as any).__veyaStrict) {
    const wl = async (req: any, extra: any) => {
      const res: any = await list(req, extra);
      for (const t of res?.tools ?? []) if (t.name in PAID_TOOL_ARGS && t.inputSchema) t.inputSchema = { ...t.inputSchema, additionalProperties: false };
      return res;
    };
    (wl as any).__veyaStrict = true; handlers.set("tools/list", wl);
  }
}
