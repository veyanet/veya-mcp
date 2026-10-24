import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { payerFee, payerKind, type PaidConfig } from "./config.js";
import { Ledger, type RunRecord } from "./state.js";
import { evaluatePolicy, probeChallenge, validateInput, type GateResult } from "./policy.js";
import { PinMismatchError, type PaidCaller, type PaidCallResult } from "./payer.js";
import { verifySolanaPayment, recentSignatures, type PaymentCheck } from "./solana.js";
import { runQuorum, canonicalJson, blake3Hex, type RunEvidence } from "./validators.js";
import type { Anchorer } from "./anchor.js";
import { writeReceipt } from "./receipt.js";

export type GuardDeps = {
  cfg: PaidConfig; stateDir: string; receiptsDir: string;
  caller: () => PaidCaller; anchorer: () => Anchorer;
  fetchImpl?: typeof fetch; verifyPollMs?: number; verifyMaxWaitMs?: number; payTimeoutMs?: number;
};
export type PaidCallArgs = { tool?: string; taskId: string; idempotencyKey: string; input: Record<string, unknown>; resourceId?: string; url?: string; taskBudgetAtomic?: string };
export type PaidCallResponse = {
  runId?: string; decision: "allowed" | "blocked"; state: string; reason?: string; output?: unknown;
  statuses?: RunRecord["statuses"]; payment?: { signature?: string; solscan?: string; feeSignature?: string };
  veya?: { commitment?: string; tx?: string; blockscout?: string }; receipt?: string; replay?: boolean;
};

const BEFORE_SIGNING = [/GuardrailError/, /not in the allowed list/, /exceeds maxPerTx/, /maxPerDay/, /approval/i, /VEYA_PIN/, /[Ii]nsufficient/, /no matching signer/, /PAYER_NOT_CONFIGURED/, /X402_NOT_SENT/];

export class PaidCallGuard {
  readonly ledger: Ledger;
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
    if (off) { this.ledger.log("blocked.disabled", { reason: off }); return { decision: "blocked", state: "disabled", reason: `EMERGENCY_DISABLED: ${off}` }; }
    const prior = this.ledger.runByIdem(a.idempotencyKey);
    if (prior) { this.ledger.log("idempotent.replay", { runId: prior.runId }); return { ...this.view(prior), replay: true }; }
    const resourceId = a.resourceId ?? cfg.resources[0].id;
    const resource = cfg.resources.find((r) => r.id === resourceId);
    if (!resource && !a.url) {
      const run0 = this.ledger.create({ runId: randomUUID(), taskId: a.taskId, idempotencyKey: a.idempotencyKey, resourceId });
      this.ledger.transition(run0.runId, "denied", `RESOURCE_NOT_ALLOWED: resource ${resourceId} not in config`, { decision: { allow: false, code: "RESOURCE_NOT_ALLOWED" } });
      return this.finish(run0.runId);
    }
    const url = a.url ?? resource?.url ?? "";
    const budget = BigInt(a.taskBudgetAtomic ?? cfg.policy.taskBudgetAtomic);
    const run = this.ledger.create({ runId: randomUUID(), taskId: a.taskId, idempotencyKey: a.idempotencyKey, resourceId });
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
      this.ledger.update(run.runId, { evidence: { quote, quoteHash: blake3Hex(canonicalJson(quote)) } });
    } catch (err) { return deny({ code: "CHALLENGE_UNAVAILABLE", reason: (err as Error).message }); }
    if (!gate.allow) return deny(gate);
    this.ledger.task(a.taskId, budget);
    const r = this.ledger.reserve(a.taskId, run.runId, gate.callCostAtomic, cfg.policy.maxCallsPerTask);
    if (!r.ok) return deny({ code: "OVER_TASK_BUDGET", reason: r.reason, checks: gate.checks });
    this.ledger.transition(run.runId, "authorized", gate.checks.join(","), { decision: { allow: true, checks: gate.checks, callCostAtomic: gate.callCostAtomic.toString(), requirement: gate.requirement } });

    // ---- Pay + call (the only money-moving step). Never retried automatically. ----
    let paid: PaidCallResult;
    try {
      paid = await withTimeout(this.d.caller().payAndCall(gate.resource, gate.requirement, a.input), this.d.payTimeoutMs ?? 120000);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (err instanceof PinMismatchError || BEFORE_SIGNING.some((re) => re.test(msg) || re.test((err as Error).name ?? ""))) {
        this.ledger.settle(run.runId, 0n);
        this.ledger.transition(run.runId, "payment_failed", `before signing: ${msg}`);
        return this.finish(run.runId);
      }
      // Money may have moved: keep the reservation as spent (conservative), keep evidence, never auto-retry.
      this.ledger.settle(run.runId, gate.callCostAtomic);
      let sigs: string[] = [];
      try { sigs = await recentSignatures(cfg.solana.rpcs[0], cfg.solana.payer, 5, this.f); } catch { /* evidence best effort */ }
      this.ledger.update(run.runId, { evidence: { ...this.ev(run.runId), error: msg.slice(0, 500), recentPayerSignatures: sigs } });
      this.ledger.transition(run.runId, "resource_error", msg.startsWith("TIMEOUT") ? "timed out; payment status unknown, not retried" : `call failed after authorization: ${msg.slice(0, 200)}`);
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
    const settleOk = !!sig && (!paid.settlement || ((paid.settlement.payer ?? cfg.solana.payer) === cfg.solana.payer && paid.settlement.network === gate.requirement.network && paid.settlement.success !== false));
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

  /** Resume a run stuck in payment_unverifiable or commit_failed. Never pays. */
  async resume(runId: string): Promise<PaidCallResponse> {
    const r = this.ledger.run(runId); if (!r) throw new Error("unknown run");
    if (!["payment_unverifiable", "commit_failed"].includes(r.state)) return this.view(r);
    if (this.disabled()) return { ...this.view(r), reason: "EMERGENCY_DISABLED" };
    if (r.state === "commit_failed") return this.anchorStep(runId);
    const e = this.ev(runId) as any; if (!e.paymentSig || !e.settlementFieldsOk) return this.view(r);
    return this.verifyAndCommit(runId, "veya_paid_call", this.d.cfg.resources.find((x) => x.id === r.resourceId)?.url ?? "", BigInt(this.ledger.taskView(r.taskId).budgetAtomic));
  }

  /**
   * For a run that errored after authorization: look for the payment on chain (payer -> payee,
   * exact amount, finalized, after the run started) and keep it as evidence. Never pays.
   * Settles the ledger to what actually moved (price only; the xPay SDK skips its fee when the call throws).
   */
  async reconcile(runId: string): Promise<PaidCallResponse> {
    const r = this.ledger.run(runId); if (!r || r.state !== "resource_error") return r ? this.view(r) : { decision: "blocked", state: "unknown" };
    const cfg = this.d.cfg; const req = (r.decision as any)?.requirement; if (!req) return this.view(r);
    const startedSec = Math.floor(new Date(r.history[0].at).getTime() / 1000) - 5;
    const deadline = Date.now() + (this.d.verifyMaxWaitMs ?? 90000);
    let match: { sig: string; check: PaymentCheck } | undefined;
    do {
      let sigs: string[] = [];
      try { sigs = await recentSignatures(cfg.solana.rpcs[0], cfg.solana.payer, 10, this.f); } catch { /* rpc down: stay unknown */ }
      for (const sig of sigs) {
        const check = await verifySolanaPayment(cfg.solana.rpcs[0], { signature: sig, payer: cfg.solana.payer, payTo: req.payTo, mint: req.asset, amountAtomic: req.amount }, this.f);
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
  private sigUsedElsewhere(sig: string, runId: string) { return this.ledger.allRuns().some((x) => x.runId !== runId && (x.evidence as any).paymentSig === sig); }

  private async verifyAndCommit(runId: string, tool: string, url: string, budget: bigint): Promise<PaidCallResponse> {
    const cfg = this.d.cfg; const e = this.ev(runId) as any; const req = (this.ledger.run(runId)!.decision as any).requirement;
    const expect = { signature: e.paymentSig, payer: cfg.solana.payer, payTo: req.payTo, mint: req.asset, amountAtomic: req.amount };
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
    const evq: RunEvidence = { runId, tool, resourceId: r.resourceId, resourceUrl: url, quote: e.quote, taskBudgetAtomic: budget.toString(), payment: expect, resultHash: e.resultHash, resultOk: e.resultShapeOk };
    const quorum = await runQuorum(cfg, evq, { fetchImpl: this.f });
    this.ledger.update(runId, { evidence: { ...this.ev(runId), quorum } });
    if (!quorum.reached) { this.ledger.transition(runId, "quorum_failed", `${quorum.agreed}/${quorum.nodes.length} agreed, need ${quorum.threshold}`); return this.finish(runId); }
    const record = {
      v: 1, record: cfg.recordVersion, runId, resourceId: r.resourceId, quoteHash: e.quoteHash, network: req.network, asset: req.asset, payTo: req.payTo, amount: req.amount,
      payer: cfg.solana.payer, paymentSig: e.paymentSig, paymentSlot: String(check.slot), feeSig: e.feeSig ?? "", resultHash: e.resultHash, verdictHash: quorum.expectedHash,
      validators: quorum.nodes.filter((n) => n.ok).map((n) => n.pubkeyHash).sort(),
    };
    const commitment = "0x" + blake3Hex(canonicalJson(record));
    this.ledger.update(runId, { evidence: { ...this.ev(runId), commitRecord: record, commitment } });
    return this.anchorStep(runId);
  }

  private async anchorStep(runId: string): Promise<PaidCallResponse> {
    const e = this.ev(runId) as any; const cfg = this.d.cfg;
    try {
      const res = await this.d.anchorer().anchor(e.commitment);
      const r = this.ledger.run(runId)!;
      this.ledger.transition(runId, "committed", res.alreadyExisted ? "commitment already on chain (no resend)" : `block ${res.blockNumber}`, {
        statuses: { ...r.statuses, veyaRecordAnchored: true },
        evidence: { ...e, veyaTx: res.txHash || e.veyaTx, blockscoutUrl: res.txHash ? `${cfg.robinhood.explorer}/tx/${res.txHash}` : e.blockscoutUrl },
      });
    } catch (err) {
      this.ledger.transition(runId, "commit_failed", (err as Error).message.slice(0, 300));
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
    const e = r.evidence as any;
    return {
      runId: r.runId, decision: (r.decision as any)?.allow ? "allowed" : "blocked", state: r.state,
      reason: r.history[r.history.length - 1].note, statuses: r.statuses,
      payment: e.paymentSig ? { signature: e.paymentSig, solscan: e.solscanUrl, feeSignature: e.feeSig } : undefined,
      veya: e.commitment ? { commitment: e.commitment, tx: e.veyaTx, blockscout: e.blockscoutUrl } : undefined,
      receipt: process.env.VEYA_PAID_RECEIPTS_BASE_URL ? `${process.env.VEYA_PAID_RECEIPTS_BASE_URL.replace(/\/$/, "")}/${r.runId}` : e.receiptPath,
    };
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`TIMEOUT after ${ms}ms`)), ms); p.then((v) => { clearTimeout(t); res(v); }, (er) => { clearTimeout(t); rej(er); }); });
}
