import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { payerFee, payerKind, type PaidConfig } from "./config.js";
import { Ledger, type RunRecord } from "./state.js";
import { evaluatePolicy, probeChallenge, validateInput, type GateResult } from "./policy.js";
import { PinMismatchError, type PaidCaller, type PaidCallResult } from "./payer.js";
import { verifySolanaPayment, recentSignatures, tokenBalance, type PaymentCheck } from "./solana.js";
import { runQuorum, canonicalJson, blake3Hex, type RunEvidence } from "./validators.js";
import type { Anchorer } from "./anchor.js";
import { writeReceipt } from "./receipt.js";

export const ANCHOR_NOT_CONFIGURED_REASON = "ANCHOR_NOT_CONFIGURED: no Robinhood Chain signing key is available for this run, so it could not be recorded. Refused before signing; nothing was checked, signed or spent.";
export const PAYER_REQUIRED_REASON = "SOLANA_KEY_REQUIRED: pass your own Solana wallet secret key in the solanaPrivateKey argument. Nothing was checked, signed or spent. The key is used in memory for this call only and is never stored.";
export const ROBINHOOD_KEY_REQUIRED_REASON = "ROBINHOOD_KEY_REQUIRED: pass your own Robinhood Chain key in the robinhoodPrivateKey argument; it signs the VEYA record and pays its gas. Nothing was signed or spent.";

export type GuardDeps = {
  cfg: PaidConfig; stateDir: string; receiptsDir: string;
  /** Builds the payer for one call. `secret` is the caller's own key (in memory, zeroed after the call); without it the operator key is used. */
  caller: (secret?: Uint8Array) => PaidCaller;
  /** Anchorer for one run. `key` is the caller's own Robinhood key (memory only) in partner mode; otherwise the operator key. */
  anchorer: (run?: RunRecord, key?: string) => Anchorer;
  /**
   * Public address of the operator payer key, if one is configured (self-host). When this is set and returns
   * undefined, a call with no caller key is refused with PAYER_REQUIRED before anything else happens.
   * When omitted, the config payer address is assumed (tests and older setups).
   */
  operatorPayer?: () => string | undefined;
  /**
   * Whether the Robinhood Chain anchor key is available. When this is set and returns false, a new metered call is
   * refused with ANCHOR_NOT_CONFIGURED before anything is signed, so nobody pays for a run that cannot be recorded.
   * Resume of already-paid runs is unaffected. When omitted, the anchor is assumed configured (tests).
   */
  anchorConfigured?: () => boolean;
  fetchImpl?: typeof fetch; verifyPollMs?: number; verifyMaxWaitMs?: number; payTimeoutMs?: number;
};
export type PaidCallArgs = {
  tool?: string; taskId: string; idempotencyKey: string; input: Record<string, unknown>; resourceId?: string; url?: string; taskBudgetAtomic?: string;
  /** Caller's own Solana payer (parsed from the solanaPrivateKey argument). Never stored; only `address` is kept as evidence. */
  payer?: { secret: Uint8Array; address: string };
  /**
   * "partner": the caller's own Solana key AND Robinhood key are required; operator keys are never used.
   * alternate mode, only ever set by the tool layer after its own server-side checks.
   * Omitted: legacy self-host behaviour (caller key, else operator key).
   */
  mode?: "partner" | "sponsored";
  /** Owner of the run (VEYA account id). Idempotency keys, task budgets and run reads are scoped to it. */
  owner?: { accountId: string; apiKeyId?: string };
  /** Caller's Robinhood Chain key (partner mode). Memory only; dropped when the call returns. */
  anchorKey?: string; robinhoodFrom?: string; environmentUuid?: string;
  /** Read-only checks (gas balance, environment) run after the policy gate allows the call and before anything is signed. */
  preflight?: () => Promise<string | null>;
};
export type PaidCallResponse = {
  runId?: string; decision: "allowed" | "blocked" | "pending"; state: string; code?: string; reason?: string; output?: unknown;
  statuses?: RunRecord["statuses"]; payment?: { signature?: string; solscan?: string; feeSignature?: string } | null;
  veya?: { commitment?: string; tx?: string; blockscout?: string; from?: string; environmentUuid?: string; anchor: "anchored" | "pending" | "failed" | "not_attempted" };
  validators?: { agreed: number; required: number; total: number; reached: boolean };
  receipt?: string; replay?: boolean;
};

/** Stable machine code for a refusal: the reason's CODE prefix, else the state in upper case. */
export function refusalCode(state: string, reason?: string): string {
  const m = /^([A-Z][A-Z0-9_]+):/.exec(reason ?? "");
  return m ? m[1] : state.toUpperCase();
}
/** Every blocked or refused answer carries `code` and `payment: null`, so a caller can see nothing moved. */
export function refused(state: string, reason: string, extra: Record<string, unknown> = {}): PaidCallResponse {
  return { decision: "blocked", state, code: refusalCode(state, reason), reason, payment: null, ...extra } as PaidCallResponse;
}
/** Clear success text for a run recorded on Robinhood Chain. */
export function recordedReason(blockNumber: number | bigint | string | undefined, txHash?: string): string {
  return `Recorded on Robinhood Chain in block ${blockNumber}` + (txHash ? `, transaction ${txHash}.` : ".");
}

/** Run states that are still being processed by another request. */
const IN_FLIGHT = ["prepared", "authorized", "paid", "verified"];
const BEFORE_SIGNING = [/GuardrailError/, /not in the allowed list/, /exceeds maxPerTx/, /maxPerDay/, /approval/i, /VEYA_PIN/, /[Ii]nsufficient/, /no matching signer/, /PAYER_NOT_CONFIGURED/, /X402_NOT_SENT/];

export class PaidCallGuard {
  readonly ledger: Ledger;
  /** Per-run caller Robinhood keys, only while that run's request is being handled. Never persisted. */
  private keys = new Map<string, string>();
  constructor(private d: GuardDeps) { this.ledger = new Ledger(d.stateDir, { writer: true }); }
  private get f() { return this.d.fetchImpl ?? fetch; }
  disabled(): string | null {
    if (!this.d.cfg.enabled) return "config enabled=false";
    if (process.env.VEYA_PAID_CALLS_DISABLED === "1") return "VEYA_PAID_CALLS_DISABLED=1";
    if (existsSync(join(this.d.stateDir, "DISABLED"))) return "emergency DISABLED flag file present";
    return null;
  }

  async call(a: PaidCallArgs): Promise<PaidCallResponse> {
    const cfg = this.d.cfg; const tool = a.tool ?? "veya_paid_call";
    const off = this.disabled();
    if (off) { this.ledger.log("blocked.disabled", { reason: off }); return refused("disabled", "EMERGENCY_DISABLED: metered calls are switched off on this server by the operator. Nothing was checked, signed or spent."); }
    const idem = a.owner ? `${a.owner.accountId}:${a.idempotencyKey}` : a.idempotencyKey;
    const taskId = a.owner ? `${a.owner.accountId}:${a.taskId}` : a.taskId;
    const prior = this.ledger.runByIdem(idem);
    if (prior) {
      this.ledger.log("idempotent.replay", { runId: prior.runId });
      if (IN_FLIGHT.includes(prior.state)) return { ...this.view(prior), decision: "pending", reason: `IN_PROGRESS: a call with this idempotencyKey is still running (state ${prior.state}). It will not pay again; read it with veya_paid_run.`, replay: true };
      return { ...this.view(prior), replay: true };
    }
    // Who pays: the caller's own key, else the operator key (self-host). Neither -> clear error, nothing created, nothing contacted.
    if (a.mode === "partner" && !a.payer) return refused("payer_required", PAYER_REQUIRED_REASON);
    if (a.mode === "partner" && !a.anchorKey) return refused("robinhood_key_required", ROBINHOOD_KEY_REQUIRED_REASON);
    const payerAddress = a.mode === "partner" ? a.payer!.address : a.payer?.address ?? this.operatorPayerAddress();
    if (!payerAddress) {
      return refused("payer_required", PAYER_REQUIRED_REASON);
    }
    if (a.mode !== "partner" && this.d.anchorConfigured && !this.d.anchorConfigured()) {
      this.ledger.log("blocked.anchor_not_configured", {});
      return refused("anchor_not_configured", ANCHOR_NOT_CONFIGURED_REASON);
    }
    const resourceId = a.resourceId ?? cfg.resources[0].id;
    const resource = cfg.resources.find((r) => r.id === resourceId);
    if (!resource && !a.url) {
      const run0 = this.ledger.create({ runId: randomUUID(), taskId, idempotencyKey: idem, resourceId });
      this.ledger.update(run0.runId, { evidence: this.ownerEvidence(a) });
      this.ledger.transition(run0.runId, "denied", `RESOURCE_NOT_ALLOWED: resource ${resourceId} not in config`, { decision: { allow: false, code: "RESOURCE_NOT_ALLOWED" } });
      return this.finish(run0.runId);
    }
    const url = a.url ?? resource?.url ?? "";
    const budget = BigInt(a.taskBudgetAtomic ?? cfg.policy.taskBudgetAtomic);
    const run = this.ledger.create({ runId: randomUUID(), taskId, idempotencyKey: idem, resourceId });
    this.ledger.update(run.runId, { evidence: this.ownerEvidence(a) });
    const deny = (g: { code: string; reason: string; checks?: string[] }) => {
      this.ledger.transition(run.runId, "denied", `${g.code}: ${g.reason}`, { decision: { allow: false, ...g } });
      return this.finish(run.runId);
    };
    // Pre-probe gate: never even contact a host/resource outside policy.
    const pre = evaluatePolicy(cfg, { tool, resourceUrl: url, resourceId, taskBudgetAtomic: budget, quote: resource ? { x402Version: resource.x402.x402Version, accepts: [{ ...resource.x402, extra: { feePayer: resource.x402.feePayer } }] } : { x402Version: 0, accepts: [] } });
    if (!pre.allow && ["TOOL_NOT_ALLOWED", "HOST_NOT_ALLOWED", "RESOURCE_NOT_ALLOWED", "OVER_TASK_BUDGET", "APPROVAL_REQUIRED"].includes(pre.code)) return deny(pre);
    const bad = validateInput(resource!, a.input);
    if (bad) return deny({ code: "INPUT_INVALID", reason: bad });
    let gate: GateResult;
    try {
      const quote = await probeChallenge(url, a.input, this.f);
      gate = evaluatePolicy(cfg, { tool, resourceUrl: url, resourceId, taskBudgetAtomic: budget, quote });
      this.ledger.update(run.runId, { evidence: { ...this.ev(run.runId), quote, quoteHash: blake3Hex(canonicalJson(quote)) } });
    } catch (err) { return deny({ code: "CHALLENGE_UNAVAILABLE", reason: (err as Error).message }); }
    if (!gate.allow) return deny(gate);
    if (a.preflight) {
      let pf: string | null;
      try { pf = await a.preflight(); } catch (err) { pf = `PREFLIGHT_UNAVAILABLE: ${publicError(err)}. Nothing was signed or spent.`; }
      if (pf) { const i = pf.indexOf(":"); return deny({ code: i > 0 ? pf.slice(0, i) : "PREFLIGHT_FAILED", reason: i > 0 ? pf.slice(i + 1).trim() : pf, checks: gate.checks }); }
    }
    this.ledger.task(taskId, budget);
    const r = this.ledger.reserve(taskId, run.runId, gate.callCostAtomic, cfg.policy.maxCallsPerTask);
    if (!r.ok) return deny({ code: "OVER_TASK_BUDGET", reason: r.reason, checks: gate.checks });
    this.ledger.transition(run.runId, "authorized", gate.checks.join(","), { decision: { allow: true, checks: gate.checks, callCostAtomic: gate.callCostAtomic.toString(), requirement: gate.requirement } });
    this.ledger.update(run.runId, { evidence: { ...this.ev(run.runId), payerAddress } });

    // Read-only funds check for a caller wallet: refuse before signing instead of sending a payment that cannot settle.
    if (a.payer) {
      let bal: bigint | undefined;
      try { bal = await tokenBalance(cfg.solana.rpcs[0], payerAddress, gate.requirement.asset!, this.f); } catch { bal = undefined; /* RPC down: let the payer library decide */ }
      if (bal !== undefined && bal < gate.callCostAtomic) {
        this.ledger.settle(run.runId, 0n);
        this.ledger.transition(run.runId, "payment_failed", `before signing: PAYER_INSUFFICIENT_FUNDS: wallet ${payerAddress} holds ${bal} atomic USDC, this call needs ${gate.callCostAtomic}. Nothing was signed or spent.`);
        return this.finish(run.runId);
      }
    }
    // ---- Pay + call (the only money-moving step). Never retried automatically. ----
    if (a.anchorKey) this.keys.set(run.runId, a.anchorKey);
    try { return await this.payStep(run.runId, a, gate, url, budget, tool, payerAddress); } finally { this.keys.delete(run.runId); }
  }

  private ownerEvidence(a: PaidCallArgs): Record<string, unknown> {
    return a.owner ? { accountId: a.owner.accountId, apiKeyId: a.owner.apiKeyId, mode: a.mode ?? "partner", taskLabel: a.taskId, idempotencyLabel: a.idempotencyKey,
      robinhoodFrom: a.robinhoodFrom, environmentUuid: a.environmentUuid } : {};
  }

  private async payStep(runId: string, a: PaidCallArgs, gate: Extract<GateResult, { allow: true }>, url: string, budget: bigint, tool: string, payerAddress: string): Promise<PaidCallResponse> {
    const cfg = this.d.cfg; const run = { runId };
    let paid: PaidCallResult;
    try {
      paid = await withTimeout(this.d.caller(a.payer?.secret).payAndCall(gate.resource, gate.requirement, a.input), this.d.payTimeoutMs ?? 120000);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (err instanceof PinMismatchError || BEFORE_SIGNING.some((re) => re.test(msg) || re.test((err as Error).name ?? ""))) {
        this.ledger.settle(run.runId, 0n);
        this.ledger.transition(run.runId, "payment_failed", `before signing: ${publicError(msg)}`);
        return this.finish(run.runId);
      }
      // Money may have moved: keep the reservation as spent (conservative), keep evidence, never auto-retry.
      this.ledger.settle(run.runId, gate.callCostAtomic);
      let sigs: string[] = [];
      try { sigs = await recentSignatures(cfg.solana.rpcs[0], payerAddress, 5, this.f); } catch { /* evidence best effort */ }
      this.ledger.update(run.runId, { evidence: { ...this.ev(run.runId), error: msg.slice(0, 500), recentPayerSignatures: sigs } });
      this.ledger.transition(run.runId, "resource_error", msg.startsWith("TIMEOUT") ? "timed out; payment status unknown, not retried" : `call failed after authorization: ${publicError(msg, 200)}`);
      await this.reconcile(run.runId);
      return this.finish(run.runId);
    }
    const sig = paid.settlement?.transaction ?? paid.txSig;
    const feeOk = !!paid.platformFee?.success;
    const fee = payerFee(cfg, gate.resource);
    this.ledger.settle(run.runId, BigInt(gate.requirement.amount!) + (feeOk ? fee.amountAtomic : 0n));
    const resultHash = blake3Hex(canonicalJson(paid.data ?? null));
    const exp = gate.resource.expectedResult;
    const shapeOk = paid.status === exp.httpStatus && typeof paid.data === "object" && paid.data !== null && exp.requiredFields.every((k) => k in (paid.data as object)) && (paid.data as any).success === exp.successValue;
    const settleOk = !!sig && (!paid.settlement || ((paid.settlement.payer ?? payerAddress) === payerAddress && paid.settlement.network === gate.requirement.network && paid.settlement.success !== false));
    this.ledger.transition(run.runId, "paid", `sig ${sig ?? "none"}`, {
      statuses: { responseReceived: true, paymentVerified: false, veyaRecordAnchored: false },
      evidence: { ...this.ev(run.runId), paymentSig: sig, solscanUrl: sig ? cfg.solana.explorer + sig : undefined, settlement: paid.settlement, amountPaid: paid.amountPaid,
        feeSig: paid.platformFee?.txSig, feeOk, feeError: paid.platformFee?.error, feeSolscanUrl: paid.platformFee?.txSig ? cfg.solana.explorer + paid.platformFee.txSig : undefined,
        payer: payerKind(cfg, gate.resource), free: paid.free ?? false, resultHash, resultShapeOk: shapeOk, settlementFieldsOk: settleOk },
    });
    (this as any)._outputs ??= new Map(); (this as any)._outputs.set(run.runId, paid.data);
    if (!shapeOk) { this.ledger.transition(run.runId, "resource_error", "result status/shape not as expected"); return this.finish(run.runId); }
    if (!sig || !settleOk) { this.ledger.transition(run.runId, "payment_unverifiable", "no settlement signature / settlement fields mismatch"); return this.finish(run.runId); }
    return this.verifyAndCommit(run.runId, tool, url, budget);
  }

  /** Address of the operator fallback payer, or undefined when every caller must pass solanaPrivateKey. */
  operatorPayerAddress(): string | undefined {
    try { return this.d.operatorPayer ? this.d.operatorPayer() : this.d.cfg.solana.payer || undefined; } catch { return undefined; }
  }

  /** Resume a run stuck in payment_unverifiable, quorum_failed or commit_failed. Never pays. */
  async resume(runId: string, anchorKey?: string): Promise<PaidCallResponse> {
    if (anchorKey) this.keys.set(runId, anchorKey);
    try { return await this.resumeInner(runId); } finally { this.keys.delete(runId); }
  }
  private async resumeInner(runId: string): Promise<PaidCallResponse> {
    const r = this.ledger.run(runId); if (!r) throw new Error("unknown run");
    if (!["payment_unverifiable", "commit_failed", "quorum_failed"].includes(r.state)) return this.view(r);
    if (this.disabled()) return { ...this.view(r), reason: "EMERGENCY_DISABLED" };
    if (r.state === "commit_failed") return this.anchorStep(runId);
    if (r.state === "quorum_failed") {
      // Payment was already verified at finalized; re-run only the validator check and the record. Never pays.
      return this.quorumStep(runId, "veya_paid_call", this.d.cfg.resources.find((x) => x.id === r.resourceId)?.url ?? "", BigInt(this.ledger.taskView(r.taskId).budgetAtomic));
    }
    const e = this.ev(runId) as any; if (!e.paymentSig || !e.settlementFieldsOk) return this.view(r);
    return this.verifyAndCommit(runId, "veya_paid_call", this.d.cfg.resources.find((x) => x.id === r.resourceId)?.url ?? "", BigInt(this.ledger.taskView(r.taskId).budgetAtomic));
  }

  /**
   * For a run that errored after authorization: look for the payment on chain (payer -> payee,
   * exact amount, finalized, after the run started) and keep it as evidence. Never pays.
   * Settles the ledger to what actually moved (price only; the xPay SDK skips its fee when the call throws).
   */
  async reconcile(runId: string): Promise<PaidCallResponse> {
    const r = this.ledger.run(runId); if (!r || r.state !== "resource_error") return r ? this.view(r) : refused("unknown", "UNKNOWN_RUN: no run with this id. Nothing was signed or spent.");
    const cfg = this.d.cfg; const req = (r.decision as any)?.requirement; if (!req) return this.view(r);
    const payer = this.payerOf(runId);
    const startedSec = Math.floor(new Date(r.history[0].at).getTime() / 1000) - 5;
    const deadline = Date.now() + (this.d.verifyMaxWaitMs ?? 90000);
    let match: { sig: string; check: PaymentCheck } | undefined;
    do {
      let sigs: string[] = [];
      try { sigs = await recentSignatures(cfg.solana.rpcs[0], payer, 10, this.f); } catch { /* rpc down: stay unknown */ }
      for (const sig of sigs) {
        const check = await verifySolanaPayment(cfg.solana.rpcs[0], { signature: sig, payer, payTo: req.payTo, mint: req.asset, amountAtomic: req.amount }, this.f);
        if (check.status === "verified" && (check.blockTime ?? 0) >= startedSec && !this.sigUsedElsewhere(sig, runId)) { match = { sig, check }; break; }
      }
      if (match) break;
      await sleep(this.d.verifyPollMs ?? 5000);
    } while (Date.now() < deadline);
    const e = this.ev(runId) as any;
    if (match) {
      this.ledger.update(runId, { statuses: { ...r.statuses, paymentVerified: true }, evidence: { ...e, paymentSig: match.sig, solscanUrl: cfg.solana.explorer + match.sig, paymentCheck: match.check, paymentMovedDespiteError: true } });
      // Actual spend = price (fee not charged when use() throws). Re-book from the conservative hold.
      this.ledger.rebook(runId, BigInt(req.amount));
      this.ledger.log("run.reconciled", { runId, sig: match.sig });
    } else this.ledger.update(runId, { evidence: { ...e, paymentMovedDespiteError: "unknown (no matching finalized payment found yet)" } });
    return this.finish(runId);
  }
  /** Payer address recorded for the run (caller's wallet or operator key); older runs fall back to the config payer. */
  private payerOf(runId: string): string { return ((this.ev(runId) as any).payerAddress as string | undefined) ?? this.d.cfg.solana.payer; }
  private sigUsedElsewhere(sig: string, runId: string) { return this.ledger.allRuns().some((x) => x.runId !== runId && (x.evidence as any).paymentSig === sig); }

  private async verifyAndCommit(runId: string, tool: string, url: string, budget: bigint): Promise<PaidCallResponse> {
    const cfg = this.d.cfg; const e = this.ev(runId) as any; const req = (this.ledger.run(runId)!.decision as any).requirement;
    const expect = { signature: e.paymentSig, payer: this.payerOf(runId), payTo: req.payTo, mint: req.asset, amountAtomic: req.amount };
    let check: PaymentCheck = { status: "unverifiable", reason: "not checked", rpc: "" };
    const deadline = Date.now() + (this.d.verifyMaxWaitMs ?? 90000);
    do {
      check = await verifySolanaPayment(cfg.solana.rpcs[0], expect, this.f);
      if (check.status !== "unverifiable") break;
      await sleep(this.d.verifyPollMs ?? 5000);
    } while (Date.now() < deadline);
    let feeCheck: PaymentCheck | undefined;
    const res = cfg.resources.find((x) => x.id === this.ledger.run(runId)!.resourceId); const fee = res ? payerFee(cfg, res) : { amountAtomic: 0n };
    if (e.feeSig && fee.payTo) feeCheck = await verifySolanaPayment(cfg.solana.rpcs[0], { ...expect, signature: e.feeSig, payTo: fee.payTo, amountAtomic: fee.amountAtomic.toString() }, this.f);
    this.ledger.update(runId, { evidence: { ...e, paymentCheck: check, feeCheck } });
    const r = this.ledger.run(runId)!;
    if (check.status !== "verified") {
      if (r.state !== "payment_unverifiable") this.ledger.transition(runId, "payment_unverifiable", `${check.status}: ${(check as any).reason}`);
      return this.finish(runId);
    }
    this.ledger.transition(runId, "verified", `slot ${check.slot}`, { statuses: { ...r.statuses, paymentVerified: true } });
    this.ledger.update(runId, { evidence: { ...this.ev(runId), paymentSlot: check.slot } });
    return this.quorumStep(runId, tool, url, budget);
  }

  /** 2-of-3 validator check on the verified payment, then the Robinhood Chain commitment. Never pays; safe to repeat. */
  private async quorumStep(runId: string, tool: string, url: string, budget: bigint): Promise<PaidCallResponse> {
    const cfg = this.d.cfg; const e = this.ev(runId) as any; const r = this.ledger.run(runId)!; const req = (r.decision as any).requirement;
    const expect = { signature: e.paymentSig, payer: this.payerOf(runId), payTo: req.payTo, mint: req.asset, amountAtomic: req.amount };
    const check = { slot: e.paymentSlot ?? e.paymentCheck?.slot };
    const evq: RunEvidence = { runId, tool, resourceId: r.resourceId, resourceUrl: url, quote: e.quote, taskBudgetAtomic: budget.toString(), payment: expect, resultHash: e.resultHash, resultOk: e.resultShapeOk };
    const quorum = await runQuorum(cfg, evq, { fetchImpl: this.f });
    this.ledger.update(runId, { evidence: { ...this.ev(runId), quorum } });
    if (!quorum.reached) {
      const note = `${quorum.agreed}/${quorum.nodes.length} agreed, need ${quorum.threshold}`;
      this.ledger.transition(runId, "quorum_failed", r.state === "quorum_failed" ? `retry: ${note}` : note);
      return this.finish(runId);
    }
    const record = {
      v: 1, record: cfg.recordVersion, runId, resourceId: r.resourceId, quoteHash: e.quoteHash, network: req.network, asset: req.asset, payTo: req.payTo, amount: req.amount,
      payer: expect.payer, paymentSig: e.paymentSig, paymentSlot: String(check.slot), feeSig: e.feeSig ?? "", resultHash: e.resultHash, verdictHash: quorum.expectedHash,
      validators: quorum.nodes.filter((n) => n.ok).map((n) => n.pubkeyHash).sort(),
    };
    const commitment = "0x" + blake3Hex(canonicalJson(record));
    this.ledger.update(runId, { evidence: { ...this.ev(runId), commitRecord: record, commitment } });
    return this.anchorStep(runId);
  }

  private async anchorStep(runId: string): Promise<PaidCallResponse> {
    const e = this.ev(runId) as any; const cfg = this.d.cfg;
    try {
      const run0 = this.ledger.run(runId)!;
      if (e.mode === "partner" && !this.keys.get(runId)) throw new Error("ROBINHOOD_KEY_REQUIRED: pass robinhoodPrivateKey to veya_paid_run with resume=true to record this run. Nothing will be spent again.");
      const res = await this.d.anchorer(run0, this.keys.get(runId)).anchor(e.commitment);
      const r = this.ledger.run(runId)!;
      this.ledger.transition(runId, "committed", res.alreadyExisted ? "Already recorded on Robinhood Chain; this commitment was found on chain, so nothing was sent again." : recordedReason(res.blockNumber, res.txHash), {
        statuses: { ...r.statuses, veyaRecordAnchored: true },
        evidence: { ...e, robinhoodFrom: res.from ?? e.robinhoodFrom, veyaTx: res.txHash || e.veyaTx, blockscoutUrl: res.txHash ? `${cfg.robinhood.explorer}/tx/${res.txHash}` : e.blockscoutUrl },
      });
    } catch (err) {
      const prev = this.ledger.run(runId)!.state;
      this.ledger.transition(runId, "commit_failed", (prev === "commit_failed" ? "retry: " : "") + publicError(err));
    }
    return this.finish(runId);
  }

  private ev(runId: string) { return this.ledger.run(runId)!.evidence; }
  private finish(runId: string): PaidCallResponse {
    const r = this.ledger.run(runId)!;
    const receipt = writeReceipt(this.d.receiptsDir, r);
    this.ledger.update(runId, { evidence: { ...r.evidence, receiptPath: receipt } });
    const out = this.view(this.ledger.run(runId)!);
    const output = (this as any)._outputs?.get(runId);
    return output !== undefined ? { ...out, output } : out;
  }
  view(r: RunRecord): PaidCallResponse {
    const e = r.evidence as any; const allowed = !!(r.decision as any)?.allow;
    const reason = r.history[r.history.length - 1].note;
    return {
      runId: r.runId, decision: allowed ? "allowed" : "blocked", state: r.state,
      ...(allowed ? {} : { code: (r.decision as any)?.code ?? refusalCode(r.state, reason) }),
      reason, statuses: r.statuses,
      payment: e.paymentSig ? { signature: e.paymentSig, solscan: e.solscanUrl, feeSignature: e.feeSig } : allowed ? undefined : null,
      veya: e.commitment || e.quorum
        ? { commitment: e.commitment, tx: e.veyaTx, blockscout: e.blockscoutUrl, from: e.robinhoodFrom, environmentUuid: e.environmentUuid ?? this.d.cfg.robinhood.environmentUuid,
            anchor: r.state === "committed" ? "anchored" : r.state === "commit_failed" ? "failed" : r.state === "verified" ? "pending" : "not_attempted" }
        : undefined,
      validators: e.quorum ? { agreed: e.quorum.agreed, required: e.quorum.threshold, total: e.quorum.nodes?.length ?? 0, reached: !!e.quorum.reached } : undefined,
      receipt: receiptUrl(r.runId),
    };
  }
}
/** Public receipt link. VEYA_PAID_RECEIPTS_BASE_URL may be the site origin or the full /receipts/paid base; never a server file path. */
export function receiptUrl(runId: string): string {
  const base = (process.env.VEYA_PAID_RECEIPTS_BASE_URL ?? "").replace(/\/+$/, "");
  const route = /\/receipts\/paid$/.test(base) ? base : `${base}/receipts/paid`;
  return `${route}/${runId}`;
}
/** Error text safe to show a caller: server file paths, RPC payloads and raw transactions are removed. */
export function publicError(err: unknown, max = 300): string {
  // ethers appends " (transaction=..., info=..., code=..., version=...)": keep the short message only.
  return String((err as Error)?.message ?? err).replace(/\s*\((transaction|info|code|action|reason|value|argument|shortMessage|error|payload|request|data)=[\s\S]*$/, "").replace(/0x[0-9a-fA-F]{200,}/g, "[raw data]").replace(/(^|[\s'"(=])\/[^\s'")]+/g, "$1[server path]").slice(0, max);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`TIMEOUT after ${ms}ms`)), ms); p.then((v) => { clearTimeout(t); res(v); }, (er) => { clearTimeout(t); rej(er); }); });
}
