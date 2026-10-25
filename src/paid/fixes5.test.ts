import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { BUNDLED_PAID_CONFIG, loadPaidConfig } from "./config.js";
import { PaidCallGuard, recordedReason, refused, refusalCode } from "./pipeline.js";
import { parseSponsoredKeys, SponsorLedger } from "./sponsored.js";
import { amountLimits, resourceAmounts, paidCallsStatus } from "./tools.js";
import { publicReceipt, renderReceiptHtml } from "./receipt.js";
import { fakeAccounts, KEY_A } from "./callerPayer.test.js";

async function setup() {
  process.env.VEYA_PAID_VALIDATOR_NODES = "https://v1.example,https://v2.example,https://v3.example";
  const cfg = loadPaidConfig(BUNDLED_PAID_CONFIG);
  const dir = mkdtempSync(join(tmpdir(), "veya-fix5-"));
  const calls = { pay: 0 };
  const fetchImpl = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  const g = new PaidCallGuard({ cfg, stateDir: join(dir, "state"), receiptsDir: join(dir, "receipts"), fetchImpl, operatorPayer: () => undefined,
    caller: () => { calls.pay++; throw new Error("must not pay"); }, anchorer: () => { throw new Error("must not anchor"); } });
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { registerPaidCallTools } = await import("./tools.js");
  const server = new McpServer({ name: "t", version: "1" });
  registerPaidCallTools(server, g, cfg, { accounts: fakeAccounts([]), sponsors: parseSponsoredKeys(""), sponsorLedger: new SponsorLedger(join(dir, "state")),
    operatorAnchorAddress: () => undefined, preflight: async () => null });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a);
  const c = new Client({ name: "c", version: "1" }); await c.connect(b);
  const call = async (name: string, args: any) => { const t = ((await c.callTool({ name, arguments: args })) as any).content[0].text; try { return JSON.parse(t); } catch { throw new Error(name + " " + JSON.stringify(Object.keys(args)) + " -> " + t); } };
  return { g, c, call, calls, cfg, dir };
}
const base = { taskId: "t", input: { assetId: "solana" }, resourceId: "tokens.asset-risk-summary" };
const isRefusal = (r: any, code: string) => { assert.equal(r.decision, "blocked"); assert.equal(r.code, code); assert.ok("payment" in r); assert.equal(r.payment, null); assert.ok(r.state); assert.ok(r.reason); };

test("fix 1: refusalCode/refused give a stable code and payment null", () => {
  assert.equal(refusalCode("x", "API_KEY_REQUIRED: pass it"), "API_KEY_REQUIRED");
  assert.equal(refusalCode("payer_required", "no prefix here"), "PAYER_REQUIRED");
  isRefusal(refused("key_limit", "KEY_LIMIT_REACHED: used up"), "KEY_LIMIT_REACHED");
  isRefusal(refused("key_limit", "KEY_LIMIT_EXPIRED: expired"), "KEY_LIMIT_EXPIRED");
});

test("fix 1: every auth, key-format, missing-key and input refusal has code + payment null", async () => {
  const s = await setup(); const rh = Wallet.createRandom().privateKey; const sol = bs58.encode(Keypair.generate().secretKey);
  isRefusal(await s.call("veya_paid_call", { ...base, idempotencyKey: "fix5-0001" }), "API_KEY_REQUIRED");
  isRefusal(await s.call("veya_paid_call", { ...base, idempotencyKey: "fix5-0002", apiKey: "nope-not-a-key", solanaPrivateKey: sol, robinhoodPrivateKey: rh }), "API_KEY_INVALID");
  isRefusal(await s.call("veya_paid_call", { ...base, idempotencyKey: "fix5-0003", apiKey: KEY_A, solanaPrivateKey: "bad", robinhoodPrivateKey: rh }), "SOLANA_KEY_INVALID");
  isRefusal(await s.call("veya_paid_call", { ...base, idempotencyKey: "fix5-0004", apiKey: KEY_A, solanaPrivateKey: "x".repeat(10), robinhoodPrivateKey: "0x12" }), "SOLANA_KEY_INVALID");
  isRefusal(await s.call("veya_paid_call", { ...base, idempotencyKey: "fix5-0005", apiKey: KEY_A }), "SOLANA_KEY_REQUIRED");
  isRefusal(await s.call("veya_paid_call", { ...base, idempotencyKey: "fix5-0006", apiKey: KEY_A, extra: 1 }), "INPUT_INVALID");
  isRefusal(await s.call("veya_paid_call", { taskId: "t", idempotencyKey: "fix5-0007", apiKey: KEY_A }), "INPUT_INVALID");
  isRefusal(await s.call("veya_paid_run", {}), "API_KEY_REQUIRED");
  const short = await s.call("veya_paid_call", { ...base, idempotencyKey: "x", apiKey: KEY_A, solanaPrivateKey: "x".repeat(40), robinhoodPrivateKey: rh });
  isRefusal(short, "INPUT_INVALID"); assert.match(short.reason, /idempotencyKey/); assert.ok(!JSON.stringify(short).includes(KEY_A));
  assert.equal(s.calls.pay, 0);
});

test("fix 1: policy denials, their replay, and the kill switch carry code + payment null", async () => {
  const s = await setup();
  const kinds: [Record<string, unknown>, string][] = [
    [{ url: "https://example.com/x" }, "HOST_NOT_ALLOWED"], [{ url: "http://api.xona-agent.com/tokens-api/asset-risk-summary" }, "HOST_NOT_ALLOWED"],
    [{ resourceId: "nope" }, "RESOURCE_NOT_ALLOWED"], [{ taskBudgetAtomic: "1" }, "OVER_TASK_BUDGET"], [{ taskBudgetAtomic: "999999999" }, "OVER_TASK_BUDGET"], [{ input: {} }, "INPUT_INVALID"],
  ];
  let i = 0;
  for (const [over, code] of kinds) {
    const r = await s.g.call({ ...base, ...over, idempotencyKey: `pol-${i++}`, owner: { accountId: "acct-a" }, payer: { secret: new Uint8Array(64), address: "Caller1111111111111111111111111111111111111" } } as any);
    isRefusal(r, code);
  }
  isRefusal(await s.g.call({ ...base, taskBudgetAtomic: "1", idempotencyKey: "pol-3", owner: { accountId: "acct-a" }, payer: { secret: new Uint8Array(64), address: "Caller1111111111111111111111111111111111111" } } as any), "OVER_TASK_BUDGET");
  process.env.VEYA_PAID_CALLS_DISABLED = "1";
  try {
    const r = await s.g.call({ ...base, idempotencyKey: "pol-off", owner: { accountId: "acct-a" }, payer: { secret: new Uint8Array(64), address: "Caller1111111111111111111111111111111111111" } } as any); isRefusal(r, "EMERGENCY_DISABLED");
    assert.doesNotMatch(r.reason ?? "", /VEYA_PAID|DISABLED=|flag file/);
    isRefusal(await s.call("veya_paid_call", { ...base, idempotencyKey: "pol-off2", apiKey: KEY_A }), "EMERGENCY_DISABLED");
  } finally { delete process.env.VEYA_PAID_CALLS_DISABLED; }
  assert.equal(s.calls.pay, 0);
});

test("fix 2+3: limits come from config; discover shows caps and quote vs total per resource", async () => {
  const s = await setup(); const L = amountLimits(s.cfg);
  assert.equal(L.perCallCapAtomic, s.cfg.policy.perCallCapAtomic); assert.equal(L.taskBudgetMaxAtomic, s.cfg.policy.taskBudgetAtomic);
  assert.equal(L.defaultTaskBudgetAtomic, s.cfg.policy.taskBudgetAtomic); assert.equal(L.perCallTotalMaxAtomic, s.cfg.policy.approvalThresholdAtomic);
  assert.equal(L.taskBudgetMax, "0.04 USDC"); assert.equal(L.perCallCap, "0.01 USDC");
  const alt = structuredClone(s.cfg); alt.policy.taskBudgetAtomic = "123456"; assert.equal(amountLimits(alt).taskBudgetMaxAtomic, "123456");
  const sdk = resourceAmounts(s.cfg, s.cfg.resources.find((r) => r.id === "tokens.risk-summary")!);
  assert.deepEqual([sdk.providerQuoteAtomic, sdk.providerFeeAtomic, sdk.totalChargedAtomic], ["10000", "10000", "20000"]); assert.match(sdk.note, /platform fee/);
  const ex = resourceAmounts(s.cfg, s.cfg.resources.find((r) => r.id === "tokens.asset-risk-summary")!);
  assert.deepEqual([ex.providerQuoteAtomic, ex.providerFeeAtomic, ex.totalChargedAtomic], ["10000", "0", "10000"]);
  const d = await s.call("veya_paid_discover", {});
  assert.equal(d.limits.taskBudgetMaxAtomic, "40000"); assert.equal(d.killSwitch, "off"); assert.match(d.killSwitchNote, /Operator-only/);
  for (const r of d.resources) assert.ok(r.amounts?.totalChargedAtomic, r.id);
  const text = JSON.stringify(d.limits) + JSON.stringify(d.resources.map((r: any) => r.amounts));
  assert.doesNotMatch(text, /pric|\bfree\b|\bpaid\b|sponsor|allowlisted key|operator wallet/i);
});

test("fix 2+4: /health + describe status shows limits, operator-only kill switch, private runs, public receipts", () => {
  process.env.VEYA_PAID_CALLS = "1"; process.env.VEYA_PAID_VALIDATOR_NODES = "https://v1.example,https://v2.example,https://v3.example";
  process.env.VEYA_PAID_STATE_DIR = mkdtempSync(join(tmpdir(), "veya-fix5h-"));
  try {
    const st: any = paidCallsStatus();
    assert.equal(st.limits.taskBudgetMaxAtomic, "40000"); assert.match(st.killSwitchNote, /Callers cannot/); assert.match(st.runsPrivacy, /private/); assert.match(st.receiptsNote, /anyone with the link/);
    assert.doesNotMatch(JSON.stringify(st), /sponsor|allowlist(ed)? key|operator wallet|xona|raeto|localhost|127\.0\.0\.1/i);
  } finally { delete process.env.VEYA_PAID_CALLS; }
});

test("fix 4: public receipt JSON/HTML hold no keys, apiKey or input", () => {
  const secret = "veya_live_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_SECRETVALUE"; const rk = Wallet.createRandom().privateKey;
  const run: any = { runId: "11111111-1111-4111-8111-111111111111", taskId: "acct:t", idempotencyKey: "acct:k", resourceId: "tokens.asset-risk-summary", state: "committed", spentAtomic: "10000",
    statuses: { responseReceived: true, paymentVerified: true, veyaRecordAnchored: true }, decision: { allow: true },
    evidence: { payerAddress: "3VYP", paymentSig: "sig", solscanUrl: "https://solscan.io/tx/sig", commitment: "0xabc", veyaTx: "0xdef", input: { assetId: "SECRETINPUT" }, apiKey: secret, anchorKey: rk, taskLabel: "t" },
    history: [{ at: "", state: "committed", note: recordedReason(5, "0xdef") }] };
  const out = JSON.stringify(publicReceipt(run)) + renderReceiptHtml(run);
  for (const bad of [secret, rk, "SECRETINPUT", "SECRETVALUE"]) assert.ok(!out.includes(bad), bad.slice(0, 6));
});

test("fix 5: success reason is a clear sentence with block and tx hash", () => {
  assert.equal(recordedReason(97565858, "0xb544"), "Recorded on Robinhood Chain in block 97565858, transaction 0xb544.");
  assert.equal(recordedReason(7), "Recorded on Robinhood Chain in block 7.");
});
