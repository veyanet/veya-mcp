/**
 * VEYA Paid Call Guard tests. NO REAL MONEY: the paid step is a mock caller, Solana RPC and the
 * provider 402 endpoint are mocked, Robinhood anchoring is a mock. Validators are the REAL local
 * Rust validator-nodes (start with scripts/validators.sh).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPaidConfig, type PaidConfig } from "./config.js";
import { PaidCallGuard } from "./pipeline.js";
import { Ledger } from "./state.js";
import type { PaidCaller, PaidCallResult } from "./payer.js";
import { PinMismatchError } from "./payer.js";
import type { Anchorer } from "./anchor.js";
import { PAID_TOOL_NAMES } from "./tools.js";

// Standalone checkout: point the shipped config at the in-process test validators.
process.env.VEYA_PAID_VALIDATOR_NODES ??= "http://127.0.0.1:7701,http://127.0.0.1:7702,http://127.0.0.1:7703";
const cfg0 = loadPaidConfig();
const R = cfg0.resources[0];
const PAYER = cfg0.solana.payer;
const MINT_IN = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const goodQuote = () => ({ x402Version: 2, error: "Payment Required", accepts: [{ scheme: "exact", network: R.x402.network, amount: R.x402.amount, asset: R.x402.asset, payTo: R.x402.payTo, maxTimeoutSeconds: 1200, extra: { feePayer: R.x402.feePayer } }] });
const SIG = (n: number) => ("5" + String(n).padStart(3, "1").replace(/0/g, "z")).padEnd(88, "A");

type World = { quote: any; rpcDown: boolean; rpcDownFor: Set<string>; txs: Map<string, any>; probes: number; nodesDown: Set<string>; tamper: Set<string> };
function mkTx(sig: string, opts: { payTo?: string; amount?: bigint; payer?: string; mint?: string; fail?: boolean } = {}) {
  const amt = opts.amount ?? 10000n, mint = opts.mint ?? R.x402.asset, payTo = opts.payTo ?? R.x402.payTo, payer = opts.payer ?? PAYER;
  return { slot: 400000000, blockTime: 1761300000, meta: { err: opts.fail ? { InstructionError: [0, "x"] } : null,
    preTokenBalances: [{ accountIndex: 1, mint, owner: payer, uiTokenAmount: { amount: "2000000" } }, { accountIndex: 2, mint, owner: payTo, uiTokenAmount: { amount: "0" } }],
    postTokenBalances: [{ accountIndex: 1, mint, owner: payer, uiTokenAmount: { amount: String(2000000n - amt) } }, { accountIndex: 2, mint, owner: payTo, uiTokenAmount: { amount: String(amt) } }] },
    transaction: { message: { accountKeys: [{ pubkey: R.x402.feePayer, signer: true }, { pubkey: payer, signer: true }] } } };
}
function mkFetch(w: World): typeof fetch {
  return (async (input: any, init?: any) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1:770")) {
      const node = url.slice(0, 21);
      if (w.nodesDown.has(node)) throw new Error("ECONNREFUSED");
      const res = await fetch(input, init);
      if (w.tamper.has(node)) { const j: any = await res.json(); j.result.blake3_execution_hash = "00".repeat(32); return new Response(JSON.stringify(j)); }
      return res;
    }
    if (cfg0.resources.some((r) => r.url === url)) { w.probes++; return new Response(JSON.stringify(w.quote), { status: 402 }); }
    if (cfg0.solana.rpcs.includes(url) || cfg0.validators.rpcs.includes(url)) {
      if (w.rpcDown || w.rpcDownFor.has(url)) throw new Error("fetch failed (mock RPC down)");
      const body = JSON.parse(init.body);
      if (body.method === "getTransaction") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: w.txs.get(body.params[0]) ?? null }));
      if (body.method === "getSignaturesForAddress") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [...w.txs.keys()].map((signature) => ({ signature })) }));
    }
    throw new Error("unexpected fetch in test: " + url);
  }) as typeof fetch;
}
class MockCaller implements PaidCaller {
  calls = 0; constructor(private impl: (n: number) => Promise<PaidCallResult>) {}
  async payAndCall() { this.calls++; return this.impl(this.calls); }
}
class MockAnchor implements Anchorer {
  calls = 0; onchain = new Set<string>(); failNext = false;
  async anchor(c: string) { this.calls++; if (this.failNext) { this.failNext = false; throw new Error("rpc down (mock)"); } if (this.onchain.has(c)) return { txHash: "", blockNumber: 0, alreadyExisted: true }; this.onchain.add(c); return { txHash: "0x" + "ab".repeat(32), blockNumber: 123, alreadyExisted: false }; }
}
const okResult = (sig: string, feeSig = SIG(900)): PaidCallResult => ({ data: { success: true, data: { score: 90, grade: "A" } }, status: 200, amountPaid: "10000", txSig: sig,
  settlement: { transaction: sig, payer: PAYER, network: R.x402.network, amount: "10000", success: true }, platformFee: { amount: 0.01, txSig: feeSig, success: true } });

function setup(opts: { cfg?: Partial<PaidConfig>; caller?: MockCaller } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "paid-"));
  const w: World = { quote: goodQuote(), rpcDown: false, rpcDownFor: new Set(), txs: new Map(), probes: 0, nodesDown: new Set(), tamper: new Set() };
  const cfg = { ...cfg0, ...(opts.cfg ?? {}) } as PaidConfig;
  let n = 0;
  const caller = opts.caller ?? new MockCaller(async () => { const s = SIG(++n); w.txs.set(s, mkTx(s)); w.txs.set(SIG(900), mkTx(SIG(900))); return okResult(s); });
  const anchor = new MockAnchor();
  const guard = new PaidCallGuard({ cfg, stateDir: join(dir, "state"), receiptsDir: join(dir, "receipts"), caller: () => caller, anchorer: () => anchor, fetchImpl: mkFetch(w), verifyPollMs: 5, verifyMaxWaitMs: 30, payTimeoutMs: 300 });
  return { guard, w, caller, anchor, dir };
}
const call = (p: PaidCallGuard, extra: Record<string, unknown> = {}) => p.call({ taskId: "task-1", idempotencyKey: "idem-" + Math.random(), input: { mint: MINT_IN }, ...extra } as any);

before(async () => { for (const n of cfg0.validators.nodes) { const r = await fetch(n + "/health"); assert.equal(r.status, 200, "validators must be running"); } });

// ---------- happy path (mock money) ----------
test("allowed call: paid -> verified -> 2/3 quorum -> committed, 3 distinct statuses, links", async () => {
  const { guard, caller, anchor, dir } = setup();
  const r = await call(guard);
  assert.equal(r.state, "committed"); assert.equal(r.decision, "allowed"); assert.equal(caller.calls, 1); assert.equal(anchor.calls, 1); assert.match(r.reason ?? "", /^Recorded on Robinhood Chain in block \d+(, transaction 0x[0-9a-fA-F]+)?\.$/);
  assert.deepEqual(r.statuses, { responseReceived: true, paymentVerified: true, veyaRecordAnchored: true });
  assert.match(r.payment!.solscan!, /^https:\/\/solscan\.io\/tx\//); assert.match(r.veya!.blockscout!, /robinhoodchain\.blockscout\.com\/tx\/0x/);
  assert.ok(existsSync(join(dir, "receipts", `${r.runId}.html`))); assert.equal(r.receipt, `/receipts/paid/${r.runId}`); assert.deepEqual(r.output, { success: true, data: { score: 90, grade: "A" } });
  const rec = guard.ledger.run(r.runId!)!; assert.deepEqual(rec.history.map((h) => h.state), ["prepared", "authorized", "paid", "verified", "committed"]);
  const e = rec.evidence as any; assert.equal(e.quorum.agreed, 3); assert.equal(e.commitRecord.resultHash.length, 64);
  assert.ok(!JSON.stringify(e.commitRecord).includes("grade"), "no raw output in commitment record");
  assert.equal(guard.ledger.taskView("task-1").spentAtomic, "20000", "price + platform fee counted");
});

test("owner evidence (account, key id) survives the quote and pay steps", async () => {
  const { guard } = setup();
  const r = await call(guard, { owner: { accountId: "acct-1", apiKeyId: "key-1" }, mode: "sponsored" });
  assert.equal(r.state, "committed");
  const e = guard.ledger.run(r.runId!)!.evidence as any;
  assert.equal(e.accountId, "acct-1"); assert.equal(e.apiKeyId, "key-1"); assert.ok(e.quote && e.payerAddress);
});
// ---------- M3 #24 ----------
test("#24 tool not allowed -> denied before any probe or payment", async () => {
  const { guard, caller, w } = setup();
  const r = await guard.call({ tool: "xpay_transfer", taskId: "t", idempotencyKey: "k-tool-0001", input: { mint: MINT_IN } });
  assert.equal(r.state, "denied"); assert.match(r.reason!, /TOOL_NOT_ALLOWED/); assert.equal(caller.calls, 0); assert.equal(w.probes, 0);
});
test("#24 host / resource not allowed -> denied before any probe or payment", async () => {
  const { guard, caller, w } = setup();
  const a = await call(guard, { url: "https://evil.example.com/tokens-api/risk-summary" });
  const b = await call(guard, { resourceId: "other.search", url: new URL("/shop/search", R.url).href });
  const c = await call(guard, { url: R.url.replace("https:", "http:") });
  assert.match(a.reason!, /HOST_NOT_ALLOWED/); assert.match(b.reason!, /RESOURCE_NOT_ALLOWED/); assert.match(c.reason!, /HOST_NOT_ALLOWED/);
  assert.equal(caller.calls, 0); assert.equal(w.probes, 0);
});
// ---------- #25 ----------
test("#25 over per-call cap (live price above cap) -> denied, no payment", async () => {
  const { guard, caller, w } = setup(); w.quote.accepts[0].amount = "20000";
  const r = await call(guard); assert.match(r.reason!, /OVER_PER_CALL_CAP/); assert.equal(caller.calls, 0);
});
test("#25 task budget too small for price+fee -> denied, no payment", async () => {
  const { guard, caller } = setup();
  const r = await call(guard, { taskBudgetAtomic: "15000" }); assert.match(r.reason!, /OVER_TASK_BUDGET/); assert.equal(caller.calls, 0);
});
test("#25 agent cannot raise task budget above policy", async () => {
  const { guard, caller } = setup();
  const r = await call(guard, { taskBudgetAtomic: "999999" }); assert.match(r.reason!, /OVER_TASK_BUDGET/); assert.equal(caller.calls, 0);
});
test("#11/#25 parallel calls cannot split past the task budget (reserved+spent)", async () => {
  const { guard, caller } = setup();
  const rs = await Promise.all([1, 2, 3, 4].map(() => call(guard, { taskBudgetAtomic: "20000" })));
  assert.equal(rs.filter((r) => r.state === "committed").length, 1); assert.equal(rs.filter((r) => /OVER_TASK_BUDGET/.test(r.reason ?? "")).length, 3);
  assert.equal(caller.calls, 1);
});
test("#25 max calls per task enforced", async () => {
  const { guard, caller } = setup({ cfg: { policy: { ...cfg0.policy, taskBudgetAtomic: "100000", maxCallsPerTask: 2 } } });
  const rs = []; for (let i = 0; i < 3; i++) rs.push(await call(guard, { taskBudgetAtomic: "100000" }));
  assert.equal(caller.calls, 2); assert.match(rs[2].reason!, /TASK_CALL_LIMIT/);
});
// ---------- #26 / #32 changed challenge ----------
for (const [field, val, code] of [["network", "eip155:8453", "NETWORK_NOT_ALLOWED"], ["asset", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "ASSET_NOT_ALLOWED"], ["payTo", "11111111111111111111111111111111", "PAYEE_NOT_ALLOWED"], ["amount", "9000", "CHALLENGE_CHANGED"], ["scheme", "upto", "CHALLENGE_CHANGED"]] as const) {
  test(`#26/#32 challenge ${field} changed -> ${code}, no payment`, async () => {
    const { guard, caller, w } = setup(); (w.quote.accepts[0] as any)[field] = val;
    const r = await call(guard); assert.equal(r.state, "denied"); assert.match(r.reason!, new RegExp(code)); assert.equal(caller.calls, 0);
  });
}
test("#32 extra payment option / feePayer change / x402 version change -> denied", async () => {
  for (const mut of [(q: any) => q.accepts.push({ ...q.accepts[0] }), (q: any) => (q.accepts[0].extra.feePayer = "So11111111111111111111111111111111111111112"), (q: any) => (q.x402Version = 1)]) {
    const { guard, caller, w } = setup(); mut(w.quote);
    const r = await call(guard); assert.equal(r.state, "denied"); assert.equal(caller.calls, 0);
  }
});
test("input validation: wrong/extra fields denied before payment", async () => {
  const { guard, caller } = setup();
  const a = await guard.call({ taskId: "t", idempotencyKey: "k-input-0001", input: { mint: "not a mint!" } });
  const b = await guard.call({ taskId: "t", idempotencyKey: "k-input-0002", input: { mint: MINT_IN, prompt: "x" } });
  assert.match(a.reason!, /INPUT_INVALID/); assert.match(b.reason!, /INPUT_INVALID/); assert.equal(caller.calls, 0);
});
// ---------- #27 ----------
test("#27 resource error after authorization -> resource_error, evidence kept, spend held, no anchor", async () => {
  const caller = new MockCaller(async () => { throw new Error("xpay.use: 500 Internal Server Error - upstream"); });
  const { guard, anchor } = setup({ caller });
  const r = await call(guard);
  assert.equal(r.state, "resource_error"); assert.equal(anchor.calls, 0); assert.equal(r.statuses!.paymentVerified, false);
  const e = guard.ledger.run(r.runId!)!.evidence as any; assert.ok(Array.isArray(e.recentPayerSignatures)); assert.match(e.error, /500/);
  assert.equal(guard.ledger.taskView("task-1").spentAtomic, "20000", "conservative: nothing found on chain, hold full cost");
});
test("#27 resource error but payment moved -> reconcile finds it on chain, keeps evidence, books price only, no anchor", async () => {
  const holder: { w?: World } = {};
  const caller = new MockCaller(async () => { const s = SIG(77); holder.w!.txs.set(s, { ...mkTx(s), blockTime: Math.floor(Date.now() / 1000) }); throw new Error("xpay.use: 404 Not Found - asset not registered"); });
  const st = setup({ caller }); holder.w = st.w;
  const r = await call(st.guard);
  assert.equal(r.state, "resource_error"); assert.equal(r.statuses!.paymentVerified, true); assert.equal(r.statuses!.veyaRecordAnchored, false);
  assert.equal(r.payment!.signature, SIG(77)); assert.equal(st.anchor.calls, 0); assert.equal(st.guard.ledger.taskView("task-1").spentAtomic, "10000");
});
test("#27 bad result shape after payment -> resource_error, payment evidence kept, no anchor", async () => {
  const caller = new MockCaller(async () => ({ ...okResult(SIG(1)), data: { success: false, error: "bad mint" } }));
  const { guard, anchor } = setup({ caller });
  const r = await call(guard); assert.equal(r.state, "resource_error"); assert.equal(r.statuses!.responseReceived, true); assert.equal(anchor.calls, 0); assert.equal(r.payment!.signature, SIG(1));
});
test("#27/#32 payment refused before signing (guardrail / payer exhausted / pin) -> payment_failed, nothing spent", async () => {
  for (const err of [Object.assign(new Error("Single call would spend $0.0200, exceeds maxPerTx $0.01"), { name: "GuardrailError" }), new Error("Insufficient balance: need 0.01 USDC on solana"), new PinMismatchError("VEYA_PIN: mismatch")]) {
    const caller = new MockCaller(async () => { throw err; });
    const { guard } = setup({ caller });
    const r = await call(guard); assert.equal(r.state, "payment_failed"); assert.equal(guard.ledger.taskView("task-1").spentAtomic, "0"); assert.equal(guard.ledger.taskView("task-1").reservedAtomic, "0");
  }
});
test("#17 returned signature that does not match chain (wrong payee / amount / failed tx) -> never verified", async () => {
  for (const bad of [{ payTo: "11111111111111111111111111111111" }, { amount: 1n }, { fail: true }, { payer: "11111111111111111111111111111112" }]) {
    let n = 0; const holder: { w?: World } = {};
    const caller = new MockCaller(async () => { const s = SIG(500 + ++n); holder.w!.txs.set(s, mkTx(s, bad)); return okResult(s); });
    const s = setup({ caller }); holder.w = s.w;
    const r = await call(s.guard); assert.equal(r.state, "payment_unverifiable"); assert.equal(r.statuses!.paymentVerified, false); assert.equal(s.anchor.calls, 0);
  }
});
test("#17 settlement fields mismatch (payer/network) -> not verified", async () => {
  const caller = new MockCaller(async () => ({ ...okResult(SIG(7)), settlement: { transaction: SIG(7), payer: "11111111111111111111111111111112", network: R.x402.network, success: true } }));
  const { guard, anchor } = setup({ caller }); const r = await call(guard); assert.equal(r.state, "payment_unverifiable"); assert.equal(anchor.calls, 0);
});
// ---------- #28 ----------
test("#15/#28 duplicate idempotency key -> replay, no second payment", async () => {
  const { guard, caller } = setup();
  const a = await guard.call({ taskId: "t", idempotencyKey: "same-key-001", input: { mint: MINT_IN } });
  const b = await guard.call({ taskId: "t", idempotencyKey: "same-key-001", input: { mint: MINT_IN } });
  assert.equal(a.runId, b.runId); assert.equal(b.replay, true); assert.equal(caller.calls, 1);
});
test("#28 timeout -> resource_error, not retried, same key replays without paying", async () => {
  const caller = new MockCaller(() => new Promise(() => {}));
  const { guard } = setup({ caller });
  const a = await guard.call({ taskId: "t", idempotencyKey: "timeout-key-1", input: { mint: MINT_IN } });
  const b = await guard.call({ taskId: "t", idempotencyKey: "timeout-key-1", input: { mint: MINT_IN } });
  assert.equal(a.state, "resource_error"); assert.match(a.reason!, /timed out/); assert.equal(b.replay, true); assert.equal(caller.calls, 1);
});
// ---------- #29 ----------
test("#29 Solana RPC down -> payment_unverifiable (pending), no anchor; resume later commits without paying", async () => {
  const { guard, w, caller, anchor } = setup(); w.rpcDown = true;
  const r = await call(guard); assert.equal(r.state, "payment_unverifiable"); assert.equal(anchor.calls, 0); assert.equal(r.statuses!.paymentVerified, false);
  w.rpcDown = false; const r2 = await guard.resume(r.runId!);
  assert.equal(r2.state, "committed"); assert.equal(caller.calls, 1);
});
test("#29 tx not yet finalized -> pending", async () => {
  const caller = new MockCaller(async () => okResult(SIG(42))); // never inserted into chain mock
  const { guard, anchor } = setup({ caller }); const r = await call(guard); assert.equal(r.state, "payment_unverifiable"); assert.match(r.reason!, /finalized/); assert.equal(anchor.calls, 0);
});
test("#29 Robinhood anchor fails -> commit_failed; resume anchors once; duplicate commitment never re-sent", async () => {
  const { guard, anchor } = setup(); anchor.failNext = true;
  const r = await call(guard); assert.equal(r.state, "commit_failed"); assert.equal(r.statuses!.veyaRecordAnchored, false);
  const r2 = await guard.resume(r.runId!); assert.equal(r2.state, "committed"); assert.equal(anchor.calls, 2);
  const c = guard.ledger.run(r.runId!)!.evidence as any; const dup = await anchor.anchor(c.commitment); assert.equal(dup.alreadyExisted, true);
});
// ---------- #30 ----------
test("#30 two validators down -> quorum_failed, no anchor", async () => {
  const { guard, w, anchor } = setup(); w.nodesDown.add("http://127.0.0.1:7701"); w.nodesDown.add("http://127.0.0.1:7702");
  const r = await call(guard); assert.equal(r.state, "quorum_failed"); assert.equal(anchor.calls, 0); assert.equal(r.statuses!.veyaRecordAnchored, false);
});
test("#30 one validator down -> 2/3 still commits", async () => {
  const { guard, w } = setup(); w.nodesDown.add("http://127.0.0.1:7703");
  const r = await call(guard); assert.equal(r.state, "committed"); assert.equal((guard.ledger.run(r.runId!)!.evidence as any).quorum.agreed, 2);
});
test("#30b quorum_failed: resume retries validation (still failing stays put), then commits once nodes are back; never pays again", async () => {
  const { guard, w, anchor, caller } = setup(); w.nodesDown.add("http://127.0.0.1:7701"); w.nodesDown.add("http://127.0.0.1:7702");
  const r = await call(guard); assert.equal(r.state, "quorum_failed"); assert.equal(caller.calls, 1);
  const again = await guard.resume(r.runId!); assert.equal(again.state, "quorum_failed"); assert.equal(anchor.calls, 0);
  w.nodesDown.clear();
  const ok = await guard.resume(r.runId!); assert.equal(ok.state, "committed"); assert.equal(anchor.calls, 1); assert.equal(caller.calls, 1);
  assert.deepEqual(ok.statuses, { responseReceived: true, paymentVerified: true, veyaRecordAnchored: true });
  const twice = await guard.resume(r.runId!); assert.equal(twice.state, "committed"); assert.equal(anchor.calls, 1);
});
test("#30 tampered signatures on 2 nodes -> quorum_failed", async () => {
  const { guard, w, anchor } = setup(); w.tamper.add("http://127.0.0.1:7701"); w.tamper.add("http://127.0.0.1:7703");
  const r = await call(guard); assert.equal(r.state, "quorum_failed"); assert.equal(anchor.calls, 0);
});
test("#30 two validators' own RPCs down -> their verdict disagrees -> quorum_failed", async () => {
  const { guard, w, anchor } = setup(); w.rpcDownFor.add(cfg0.validators.rpcs[0]); w.rpcDownFor.add(cfg0.validators.rpcs[2]); assert.notEqual(cfg0.validators.rpcs[0], cfg0.solana.rpcs[0]);
  const r = await call(guard); assert.equal(r.state, "quorum_failed"); assert.equal(anchor.calls, 0);
});
// ---------- #16 ----------
test("#16 state machine rejects illegal transitions (fail closed)", () => {
  const l = new Ledger(mkdtempSync(join(tmpdir(), "xl-")));
  l.create({ runId: "r", taskId: "t", idempotencyKey: "k-sm-00001", resourceId: R.id });
  assert.throws(() => l.transition("r", "committed"), /illegal/); assert.throws(() => l.transition("r", "paid"), /illegal/);
  l.transition("r", "denied"); assert.throws(() => l.transition("r", "authorized"), /illegal/);
});
// ---------- #33 ----------
test("#33 emergency disable (env + flag file) blocks before anything; audit log written", async () => {
  const { guard, caller, w, dir } = setup();
  process.env.VEYA_PAID_CALLS_DISABLED = "1"; const a = await call(guard); delete process.env.VEYA_PAID_CALLS_DISABLED;
  writeFileSync(join(dir, "state", "DISABLED"), "1"); const b = await call(guard);
  assert.match(a.reason!, /EMERGENCY_DISABLED/); assert.match(b.reason!, /EMERGENCY_DISABLED/); assert.equal(caller.calls, 0); assert.equal(w.probes, 0);
  const log = readFileSync(join(dir, "state", "audit.log"), "utf8"); assert.match(log, /blocked\.disabled/);
});
test("#33 no secrets in logs/ledger/receipts", async () => {
  const { guard, dir } = setup(); await call(guard);
  const kp = process.env.VEYA_PAID_SOLANA_KEY_PATH;
  const secret = kp && existsSync(kp) ? JSON.parse(readFileSync(kp, "utf8")) as number[] : Array.from((await import("@solana/web3.js")).Keypair.generate().secretKey);
  const b58 = (await import("bs58")).default.encode(Uint8Array.from(secret));
  for (const sub of ["state", "receipts"]) for (const f of readdirSync(join(dir, sub))) {
    const s = readFileSync(join(dir, sub, f), "utf8"); assert.ok(!s.includes(b58) && !s.includes(JSON.stringify(secret)) && !/PRIVATE_KEY/.test(s), f);
  }
});
// ---------- #14 / #31 ----------
test("#14/#31 tool manifest: only the 3 VEYA paid-call tools, no key/transfer/swap/trade/do/xpay tools", async () => {
  process.env.VEYA_PAID_CALLS = "1";
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { registerPaidCallTools } = await import("./tools.js");
  const s = new McpServer({ name: "t", version: "0" });
  registerPaidCallTools(s, setup().guard, cfg0);
  const names = Object.keys((s as any)._registeredTools);
  assert.deepEqual(names.sort(), [...PAID_TOOL_NAMES].sort());
  for (const n of names) assert.doesNotMatch(n, /transfer|swap|trade|^do$|xpay|key|wallet|bridge/i);
  const src = readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  for (const f of src) {
    const s2 = readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    if (f !== "payer.ts") assert.doesNotMatch(s2, /\/xpay["']/, `${f} must not import the xPay SDK`);
    assert.doesNotMatch(s2, /\.(do|transfer|swap|trade|swapTokens|tradeTokens)\(|forClaude|forOpenAI|forGemini|xpay-mcp/, f);
  }
});
// ---------- #13 real xPay guardrail. Uses a THROWAWAY random key and calls guardrail.check only: nothing is signed. ----------
test("#13 real xPay guardrail (maxPerTx, allowedHosts, approval) + VEYA pin refuse at the signing boundary", async () => {
  const { buildGuardedXpay } = await import("./payer.js");
  const { Keypair } = await import("@solana/web3.js");
  const throwaway = Keypair.generate().secretKey;
  const pinned = goodQuote().accepts[0];
  const res = { resource: R.url, type: "http", method: "POST", accepts: [pinned] };
  const x = await buildGuardedXpay(cfg0, throwaway, pinned);
  await x.guardrail.check({ resource: res as any, requirement: pinned as any }); // allowed
  const over = { ...pinned, amount: "20000" };
  const x2 = await buildGuardedXpay(cfg0, throwaway, over);
  await assert.rejects(() => x2.guardrail.check({ resource: res as any, requirement: over as any }), /maxPerTx/);
  await assert.rejects(() => x.guardrail.check({ resource: { ...res, resource: "https://evil.example.com/x" } as any, requirement: pinned as any }), /not in the allowed list/);
  await assert.rejects(() => x.guardrail.check({ resource: res as any, requirement: { ...pinned, payTo: "11111111111111111111111111111111" } as any }), /VEYA_PIN/);
  const apprCfg = structuredClone(cfg0); apprCfg.providers[0].sdk!.guardrail.requireApprovalAbove = 0.005;
  const x3 = await buildGuardedXpay(apprCfg, throwaway, pinned);
  await assert.rejects(() => x3.guardrail.check({ resource: res as any, requirement: pinned as any }), /approv/i);
});

test("validators use three independent Solana RPC providers (release config + loader guard + per-node routing)", async () => {
  const { rpcProvider, assertIndependentRpcs } = await import("./config.js");
  const provs = cfg0.validators.rpcs.slice(0, 3).map(rpcProvider);
  assert.equal(new Set(provs).size, 3, provs.join(","));
  const dup = structuredClone(cfg0); dup.validators.rpcs = ["https://a.publicnode.com", "https://api.mainnet-beta.solana.com", "https://b.publicnode.com"];
  assert.throws(() => assertIndependentRpcs(dup), /share an RPC provider/);
  const short = structuredClone(cfg0); short.validators.rpcs = short.validators.rpcs.slice(0, 2);
  assert.throws(() => assertIndependentRpcs(short), /one Solana RPC per validator/);
  const { guard } = setup(); const r = await call(guard); assert.equal(r.state, "committed");
  const nodes = (guard.ledger.run(r.runId!)!.evidence as any).quorum.nodes as { rpc: string }[];
  assert.deepEqual(nodes.map((n) => n.rpc), cfg0.validators.rpcs.slice(0, 3), "each node read the chain through its own RPC");
});
test("LIVE (VEYA_PAID_LIVE_RPC=1): every validator RPC verifies a real earlier payment at finalized", { skip: process.env.VEYA_PAID_LIVE_RPC !== "1" }, async () => {
  const { verifySolanaPayment } = await import("./solana.js");
  for (const rpc of cfg0.validators.rpcs) {
    const c = await verifySolanaPayment(rpc, { signature: "4bQewAsnfZdB8Utfk8VZyMsagrNtK4ZjJfHK4ErKy4ZeS6FS7zboM3YqpzKtjvsAK7DWKaVUcEmQjvrycFPKbVgB", payer: cfg0.solana.payer, payTo: "9VaDVp1Wb78G4Wm6VuTiMrpESjrUymXefQTHcJGRSTEA", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountAtomic: "10000" });
    assert.equal(c.status, "verified", rpc + " " + JSON.stringify(c));
  }
});
test("receipt route: served HTML + public JSON, no output content, rejects bad ids", async () => {
  const express = (await import("express")).default; const { mountPaidReceipts } = await import("./receiptRoutes.js");
  const { guard } = setup(); const r = await call(guard); assert.equal(r.state, "committed");
  const dir = (guard as any).d.stateDir as string;
  const app = express(); mountPaidReceipts(app, dir);
  const srv = app.listen(0); const port = (srv.address() as any).port; const base = `http://127.0.0.1:${port}/receipts/paid/`;
  try {
    const h = await fetch(base + r.runId); const html = await h.text();
    assert.equal(h.status, 200); assert.match(html, /VEYA run receipt/); assert.match(html, /solscan\.io\/tx\//); assert.match(html, /blockscout/);
    const j = await (await fetch(base + r.runId + ".json")).json() as any;
    assert.equal(j.decision, "allowed"); assert.equal(j.statuses.veyaRecordAnchored, true);
    const out = JSON.stringify((guard.ledger.run(r.runId!)!.evidence as any).output ?? {});
    for (const body of [html, JSON.stringify(j)]) { assert.ok(!body.includes('"output"')); if (out.length > 4) assert.ok(!body.includes(out)); }
    assert.equal((await fetch(base + "..%2Fsecrets")).status, 400);
    assert.equal((await fetch(base + "00000000-0000-0000-0000-000000000000")).status, 404);
  } finally { srv.close(); }
});

// ---------- generic x402 `exact` payer path (mocks only, no money) ----------
const R2 = cfg0.resources.find((r) => r.payer === "x402-exact")!;
const req2 = () => ({ scheme: "exact", network: R2.x402.network, amount: R2.x402.amount, asset: R2.x402.asset, payTo: R2.x402.payTo, maxTimeoutSeconds: 1200, extra: { feePayer: R2.x402.feePayer } });
const settleHeader = (sig: string) => Buffer.from(JSON.stringify({ success: true, transaction: sig, network: R2.x402.network, payer: PAYER })).toString("base64");
function keyFile() { const d = mkdtempSync(join(tmpdir(), "paid-key-")); const p = join(d, "k.json"); return import("@solana/web3.js").then(({ Keypair }) => { writeFileSync(p, JSON.stringify(Array.from(Keypair.generate().secretKey))); return p; }); }

test("config: payer is chosen per resource; standard x402 path has no payer fee", async () => {
  const { payerKind, payerFee } = await import("./config.js");
  assert.equal(payerKind(cfg0, R), "xpay-sdk"); assert.equal(payerFee(cfg0, R).amountAtomic, 10000n);
  assert.equal(payerKind(cfg0, R2), "x402-exact"); assert.equal(payerFee(cfg0, R2).amountAtomic, 0n);
});
test("config loader refuses unknown payer, missing provider, xpay-sdk without sdk settings", async () => {
  const { loadPaidConfig: load } = await import("./config.js");
  const d = mkdtempSync(join(tmpdir(), "paid-cfg-"));
  const bad = (mut: (c: PaidConfig) => void) => { const c = structuredClone(cfg0); mut(c); const p = join(d, Math.random() + ".json"); writeFileSync(p, JSON.stringify(c)); return p; };
  assert.throws(() => load(bad((c) => { (c.resources[1] as any).payer = "transfer"; })), /unknown payer/);
  assert.throws(() => load(bad((c) => { c.resources[0].provider = "nope"; })), /unknown provider/);
  assert.throws(() => load(bad((c) => { delete c.providers[0].sdk; })), /no sdk settings/);
});
test("x402-exact resource: cost = price only; paid -> verified -> 2/3 -> committed; spend 10000", async () => {
  let n = 0; const st: any = {};
  const caller = new MockCaller(async () => { const s = SIG(500 + ++n); st.w.txs.set(s, mkTx(s)); return { data: { success: true, data: { score: 88 } }, status: 200, amountPaid: "10000", txSig: s, settlement: { transaction: s, payer: PAYER, network: R2.x402.network, amount: "10000", success: true } }; });
  Object.assign(st, setup({ caller }));
  const r = await st.guard.call({ taskId: "task-x", idempotencyKey: "idem-x402-0001", resourceId: R2.id, input: { assetId: "solana" } });
  assert.equal(r.state, "committed", r.reason); assert.equal(r.payment.feeSignature, undefined);
  assert.equal(st.guard.ledger.taskView("task-x").spentAtomic, "10000");
  assert.equal((st.guard.ledger.run(r.runId).evidence as any).payer, "x402-exact");
});
test("x402-exact resource input: slug/mint checked, unknown fields refused, before any payment", async () => {
  const { guard, caller } = setup();
  const a = await guard.call({ taskId: "t", idempotencyKey: "k-slug-0001", resourceId: R2.id, input: { assetId: "Solana!" } });
  const b = await guard.call({ taskId: "t", idempotencyKey: "k-slug-0002", resourceId: R2.id, input: { assetId: "solana", note: "x" } });
  const c = await guard.call({ taskId: "t", idempotencyKey: "k-slug-0003", resourceId: R2.id, input: { assetId: "solana", mint: "not-base58!" } });
  const d = await guard.call({ taskId: "t", idempotencyKey: "k-slug-0004", resourceId: R2.id, input: {} });
  for (const x of [a, b, c, d]) assert.match(x.reason!, /INPUT_INVALID/);
  assert.equal(caller.calls, 0);
});
test("createX402Caller: offers only the authorized requirement, sends one paid request, reads settlement", async () => {
  const { createX402Caller } = await import("./payer.js");
  const seen: any = {}; let fetches = 0;
  const c = createX402Caller(cfg0, await keyFile(), {
    buildPayload: async (secret, pr) => { seen.pr = pr; seen.secretLen = secret.length; return { payload: { x402Version: 2, accepted: pr.accepts[0], payload: { transaction: "dHg=" } }, headers: { "PAYMENT-SIGNATURE": "sig-header" }, readSettle: (get) => JSON.parse(Buffer.from(get("PAYMENT-RESPONSE")!, "base64").toString()) }; },
    fetchImpl: (async (url: any, init: any) => { fetches++; seen.url = String(url); seen.headers = init.headers; seen.body = init.body; return new Response(JSON.stringify({ success: true, data: { score: 1 } }), { status: 200, headers: { "PAYMENT-RESPONSE": settleHeader(SIG(601)) } }); }) as typeof fetch,
  });
  const out = await c.payAndCall(R2, req2(), { assetId: "solana" });
  assert.equal(fetches, 1); assert.equal(seen.url, R2.url); assert.equal(seen.headers["PAYMENT-SIGNATURE"], "sig-header"); assert.equal(seen.body, JSON.stringify({ assetId: "solana" }));
  assert.equal(seen.pr.accepts.length, 1); assert.deepEqual(seen.pr.accepts[0], req2()); assert.equal(seen.pr.resource.url, R2.url); assert.equal(seen.secretLen, 64);
  assert.equal(out.txSig, SIG(601)); assert.equal(out.settlement!.payer, PAYER); assert.equal(out.platformFee, undefined); assert.equal(out.status, 200);
});
test("createX402Caller: payload that drifts from the authorized requirement is refused before sending", async () => {
  const { createX402Caller, PinMismatchError: PME } = await import("./payer.js");
  let fetches = 0; const f = (async () => { fetches++; return new Response("{}"); }) as unknown as typeof fetch;
  for (const drift of [{ payTo: "11111111111111111111111111111111" }, { amount: "20000" }, { asset: "So11111111111111111111111111111111111111112" }, { network: "solana:devnet" }]) {
    const c = createX402Caller(cfg0, await keyFile(), { fetchImpl: f, buildPayload: async (_s, pr) => ({ payload: { x402Version: 2, accepted: { ...pr.accepts[0], ...drift }, payload: {} }, headers: {}, readSettle: () => ({}) }) });
    await assert.rejects(() => c.payAndCall(R2, req2(), { assetId: "solana" }), (e: unknown) => e instanceof PME);
  }
  const c2 = createX402Caller(cfg0, await keyFile(), { fetchImpl: f, buildPayload: async () => { throw new Error("should not build"); } });
  await assert.rejects(() => c2.payAndCall(R2, { ...req2(), scheme: "upto" }, {}), (e: unknown) => e instanceof PME);
  assert.equal(fetches, 0);
});
test("createX402Caller: no settlement header -> error (payment status unknown), pipeline keeps the hold and reconciles", async () => {
  const { createX402Caller } = await import("./payer.js");
  const c = createX402Caller(cfg0, await keyFile(), {
    buildPayload: async (_s, pr) => ({ payload: { x402Version: 2, accepted: pr.accepts[0], payload: {} }, headers: { "PAYMENT-SIGNATURE": "x" }, readSettle: (get) => { const h = get("PAYMENT-RESPONSE"); if (!h) throw new Error("no header"); return JSON.parse(h); } }),
    fetchImpl: (async () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 })) as unknown as typeof fetch,
  });
  await assert.rejects(() => c.payAndCall(R2, req2(), { assetId: "solana" }), /X402_NO_SETTLEMENT: HTTP 404/);
  const { guard } = setup({ caller: new MockCaller(() => c.payAndCall(R2, req2(), { assetId: "solana" })) });
  const r = await guard.call({ taskId: "task-y", idempotencyKey: "idem-x402-nosettle", resourceId: R2.id, input: { assetId: "solana" } });
  assert.equal(r.state, "resource_error"); assert.equal(guard.ledger.taskView("task-y").spentAtomic, "10000", "conservative hold = price only on this path");
});
test("official @x402 libraries build an exact payload for only the authorized requirement (mock Solana RPC, nothing sent)", async () => {
  const { buildX402Payload } = await import("./payer.js");
  const { createServer } = await import("node:http");
  const bs58 = (await import("bs58")).default;
  const mintData = Buffer.alloc(82); mintData.writeBigUInt64LE(10n ** 15n, 36); mintData[44] = 6; mintData[45] = 1;
  const calls: string[] = [];
  const srv = createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const j = JSON.parse(b); calls.push(j.method);
    const result = j.method === "getAccountInfo" ? { context: { slot: 1 }, value: { data: [mintData.toString("base64"), "base64"], executable: false, lamports: 1461600, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", rentEpoch: 0, space: 82 } }
      : j.method === "getLatestBlockhash" ? { context: { slot: 1 }, value: { blockhash: bs58.encode(Buffer.alloc(32, 7)), lastValidBlockHeight: 1000 } } : null;
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id, result }));
  }); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  try {
    const { Keypair } = await import("@solana/web3.js");
    const pr = { x402Version: 2, resource: { url: R2.url, description: R2.description, mimeType: "application/json" }, accepts: [req2()] };
    const out = await buildX402Payload(Keypair.generate().secretKey, pr, `http://127.0.0.1:${(srv.address() as any).port}`);
    assert.equal(out.payload.x402Version, 2); assert.deepEqual({ ...out.payload.accepted, extra: { feePayer: (out.payload.accepted.extra as any).feePayer } }, req2());
    assert.equal(typeof (out.payload.payload as any).transaction, "string");
    assert.ok(Object.keys(out.headers).some((h) => /payment-signature/i.test(h)), JSON.stringify(Object.keys(out.headers)));
    assert.ok(!calls.includes("sendTransaction") && !calls.includes("sendRawTransaction"), "nothing is ever submitted by VEYA on this path: " + calls.join(","));
  } finally { srv.close(); }
});

test("HTTP transport: every per-request server shares one process-wide guard and ledger (parallel budget stays atomic)", async () => {
  process.env.VEYA_PAID_STATE_DIR = mkdtempSync(join(tmpdir(), "paid-shared-"));
  const { sharedGuard } = await import("./tools.js");
  const a = sharedGuard(), b = sharedGuard();
  assert.equal(a.guard, b.guard); assert.equal(a.guard.ledger, b.guard.ledger);
});
test("unknown resourceId -> RESOURCE_NOT_ALLOWED before any probe or payment", async () => {
  const { guard, caller, w } = setup();
  const r = await call(guard, { resourceId: "tokens.nope" });
  assert.equal(r.state, "denied"); assert.match(r.reason!, /RESOURCE_NOT_ALLOWED/); assert.equal(caller.calls, 0); assert.equal(w.probes, 0);
});
test("state folder lock: a second live process cannot write the same ledger", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paid-lock-"));
  new Ledger(dir, { writer: true }); new Ledger(dir, { writer: true }); // same process: fine
  writeFileSync(join(dir, "ledger.lock"), String(process.ppid)); // a live other process
  assert.throws(() => new Ledger(dir, { writer: true }), /STATE_LOCKED/);
  writeFileSync(join(dir, "ledger.lock"), "999999"); // stale pid
  new Ledger(dir, { writer: true });
});

test("#29b anchor missing after payment: resume stays commit_failed cleanly (no throw, no pay), then commits once configured", async () => {
  const { guard, anchor, caller } = setup(); const d = (guard as any).d; let configured = false;
  d.anchorer = () => { if (!configured) throw new Error("ANCHOR_NOT_CONFIGURED"); return anchor; };
  const r = await call(guard); assert.equal(r.state, "commit_failed"); assert.match(r.reason!, /ANCHOR_NOT_CONFIGURED/);
  assert.deepEqual(r.validators, { agreed: 3, required: 2, total: 3, reached: true }); assert.equal(r.veya!.anchor, "failed");
  const again = await guard.resume(r.runId!); assert.equal(again.state, "commit_failed"); assert.match(again.reason!, /^retry: ANCHOR_NOT_CONFIGURED/);
  const again2 = await guard.resume(r.runId!); assert.equal(again2.state, "commit_failed");
  assert.equal(caller.calls, 1); assert.equal(anchor.calls, 0);
  configured = true;
  const ok = await guard.resume(r.runId!); assert.equal(ok.state, "committed"); assert.equal(ok.veya!.anchor, "anchored"); assert.ok(ok.veya!.tx);
  assert.equal(ok.validators!.agreed, 3); assert.equal(caller.calls, 1); assert.equal(anchor.calls, 1);
});

test("#29c anchor not configured: new paid call refused before anything is signed or paid; replay of earlier runs still answers", async () => {
  const { guard, caller, w } = setup(); const d = (guard as any).d;
  const first = await call(guard); assert.equal(first.state, "committed");
  d.anchorConfigured = () => false; const probes = w.probes;
  const r = await guard.call({ taskId: "t-anchor", idempotencyKey: "idem-anchor-none", input: { assetId: "solana" } });
  assert.equal(r.state, "anchor_not_configured"); assert.equal(r.decision, "blocked"); assert.match(r.reason!, /^ANCHOR_NOT_CONFIGURED: .*nothing was checked, signed or spent/);
  assert.equal(caller.calls, 1); assert.equal(w.probes, probes); assert.equal(r.runId, undefined);
});

test("#30c quorum_failed retry that fails again stays quorum_failed with a retry reason", async () => {
  const { guard, w, caller } = setup(); w.nodesDown.add("http://127.0.0.1:7701"); w.nodesDown.add("http://127.0.0.1:7702");
  const r = await call(guard); assert.deepEqual(r.validators, { agreed: 1, required: 2, total: 3, reached: false }); assert.equal(r.veya!.anchor, "not_attempted");
  const again = await guard.resume(r.runId!); assert.equal(again.state, "quorum_failed"); assert.match(again.reason!, /^retry: 1\/3/); assert.equal(caller.calls, 1);
});
