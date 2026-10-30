import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bs58 from "bs58";
import { parsePayerKey, addressFromKeyFile } from "./payerKey.js";
import { BUNDLED_PAID_CONFIG, loadPaidConfig } from "./config.js";
import { PaidCallGuard } from "./pipeline.js";
import { renderReceiptHtml, publicReceipt } from "./receipt.js";
import { writeFileSync } from "node:fs";

async function freshKey() {
  const { webcrypto } = await import("node:crypto");
  const kp = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", kp.privateKey));
  const raw = new Uint8Array(await webcrypto.subtle.exportKey("raw", kp.publicKey));
  const seed = pkcs8.slice(-32);
  return { secret: Uint8Array.from([...seed, ...raw]), address: bs58.encode(raw) };
}
export const KEY_A = "veya_live_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_secretA";
export function fakeAccounts(saved: any[] = []) {
  return {
    async account(k: string) { const { AccountError } = await import("./tools.js"); if (!k.startsWith("veya_")) throw new AccountError("API_KEY_INVALID: bad"); if (k.includes("revoked")) throw new AccountError("API_KEY_INVALID: this apiKey was rejected (unknown or revoked). Nothing was signed or spent."); return { accountId: k.includes("bbbb") ? "acct-B" : "acct-A", wallet: "0x0" }; },
    async saveRun(_k: string, r: any) { saved.push(r); }, async getRun() { return undefined; }, async listRuns() { return { paidRuns: saved }; },
  };
}
const nodes = "https://v1.example,https://v2.example,https://v3.example";

test("parsePayerKey: base58 and JSON array give the same address; bad keys are refused without echoing them", async () => {
  const k = await freshKey();
  const a = await parsePayerKey(bs58.encode(k.secret));
  const b = await parsePayerKey(JSON.stringify([...k.secret]));
  assert.equal(a.address, k.address); assert.equal(b.address, k.address);
  const tampered = Uint8Array.from(k.secret); tampered[40] ^= 1;
  for (const bad of ["not a key", "[1,2,3]", bs58.encode(tampered)]) {
    await assert.rejects(parsePayerKey(bad), (e: Error) => /SOLANA_KEY_INVALID/.test(e.message) && !e.message.includes(bad.slice(0, 12)));
  }
  const dir = mkdtempSync(join(tmpdir(), "veya-key-")); const f = join(dir, "k.json");
  writeFileSync(f, JSON.stringify([...k.secret]));
  assert.equal(addressFromKeyFile(f), k.address);
});

test("bundled config ships with the package and loads once validator URLs are set", () => {
  assert.ok(existsSync(BUNDLED_PAID_CONFIG));
  const prev = process.env.VEYA_PAID_VALIDATOR_NODES;
  try {
    delete process.env.VEYA_PAID_VALIDATOR_NODES;
    assert.throws(() => loadPaidConfig(BUNDLED_PAID_CONFIG), /VEYA_PAID_VALIDATOR_NODES/);
    process.env.VEYA_PAID_VALIDATOR_NODES = nodes;
    const cfg = loadPaidConfig(BUNDLED_PAID_CONFIG);
    assert.equal(cfg.validators.nodes.length, 3); assert.ok(cfg.resources.length >= 1);
  } finally { if (prev === undefined) delete process.env.VEYA_PAID_VALIDATOR_NODES; else process.env.VEYA_PAID_VALIDATOR_NODES = prev; }
});

function guardNoOperator(onCall: () => void) {
  process.env.VEYA_PAID_VALIDATOR_NODES = nodes;
  const cfg = loadPaidConfig(BUNDLED_PAID_CONFIG);
  const dir = mkdtempSync(join(tmpdir(), "veya-paid-"));
  const fetchImpl = (async () => { onCall(); throw new Error("network must not be used"); }) as unknown as typeof fetch;
  const g = new PaidCallGuard({ cfg, stateDir: join(dir, "state"), receiptsDir: join(dir, "receipts"), operatorPayer: () => undefined,
    caller: () => { onCall(); throw new Error("must not pay"); }, anchorer: () => { throw new Error("must not anchor"); }, fetchImpl });
  return { g, dir };
}

test("no caller key and no operator key: PAYER_REQUIRED before anything; no run, no network, idempotency key stays free", async () => {
  let touched = 0;
  const { g, dir } = guardNoOperator(() => touched++);
  const r = await g.call({ taskId: "t1", idempotencyKey: "idem-nokey-1", resourceId: "tokens.asset-risk-summary", input: { assetId: "solana" } });
  assert.equal(r.state, "payer_required"); assert.equal(r.decision, "blocked"); assert.match(r.reason!, /SOLANA_KEY_REQUIRED/);
  assert.equal(r.runId, undefined); assert.equal(touched, 0);
  assert.equal(g.ledger.runByIdem("idem-nokey-1"), undefined);
  assert.ok(!existsSync(join(dir, "receipts")) || readdirSync(join(dir, "receipts")).length === 0);
});

test("caller key present: out-of-policy call is blocked before payment and the receipt names the payer address only", async () => {
  let touched = 0;
  const { g } = guardNoOperator(() => touched++);
  const k = await freshKey();
  const r = await g.call({ taskId: "t2", idempotencyKey: "idem-host-1", url: "https://example.com/paid", resourceId: "other", input: {}, payer: { secret: k.secret, address: k.address } });
  assert.equal(r.decision, "blocked"); assert.match(r.reason!, /RESOURCE_NOT_ALLOWED|HOST_NOT_ALLOWED/); assert.equal(touched, 0);
  const run = g.ledger.run(r.runId!)!;
  const blob = JSON.stringify(run);
  assert.ok(!blob.includes(bs58.encode(k.secret)) && !blob.includes(JSON.stringify([...k.secret])), "secret never stored");
});

test("receipt for payment_failed: no cross-chain claim; JSON carries the reason", () => {
  const run: any = {
    runId: "03dadc81-c268-4966-b9ec-52462661ff05", taskId: "t", idempotencyKey: "k", resourceId: "tokens.asset-risk-summary", state: "payment_failed",
    decision: { allow: true }, statuses: { responseReceived: false, paymentVerified: false, veyaRecordAnchored: false },
    evidence: { payerAddress: "PayerAddr111" }, history: [{ at: new Date().toISOString(), state: "payment_failed", note: "before signing: X402_NOT_SENT: insufficient funds" }],
  };
  const html = renderReceiptHtml(run);
  assert.ok(!/This is cross-chain evidence/.test(html)); assert.match(html, /did not go through/); assert.match(html, /X402_NOT_SENT/);
  const j = publicReceipt(run) as any;
  assert.match(j.reason, /X402_NOT_SENT/); assert.equal(j.payer, "PayerAddr111");
  const ok = renderReceiptHtml({ ...run, state: "committed", history: [{ at: "", state: "committed", note: "block 1" }] });
  assert.match(ok, /This is cross-chain evidence/);
});

test("receipt link always points at /receipts/paid/<runId>, never a file path", async () => {
  const { receiptUrl } = await import("./pipeline.js");
  const prev = process.env.VEYA_PAID_RECEIPTS_BASE_URL;
  try {
    for (const [base, want] of [["https://mcp.veyanet.tech", "https://mcp.veyanet.tech/receipts/paid/r1"], ["https://mcp.veyanet.tech/", "https://mcp.veyanet.tech/receipts/paid/r1"], ["https://mcp.veyanet.tech/receipts/paid", "https://mcp.veyanet.tech/receipts/paid/r1"], ["https://mcp.veyanet.tech/receipts/paid/", "https://mcp.veyanet.tech/receipts/paid/r1"]]) {
      process.env.VEYA_PAID_RECEIPTS_BASE_URL = base; assert.equal(receiptUrl("r1"), want);
    }
    delete process.env.VEYA_PAID_RECEIPTS_BASE_URL; assert.equal(receiptUrl("r1"), "/receipts/paid/r1");
  } finally { if (prev === undefined) delete process.env.VEYA_PAID_RECEIPTS_BASE_URL; else process.env.VEYA_PAID_RECEIPTS_BASE_URL = prev; }
});

test("anchor errors shown to callers never contain server file paths", async () => {
  const { publicError } = await import("./pipeline.js");
  const m = publicError(new Error("ENOENT: no such file or directory, open '/srv/secrets/robinhood-anchor.key'"));
  assert.ok(!m.includes("/srv/") && !m.includes("anchor.key")); assert.match(m, /ENOENT/);
  assert.match(publicError(new Error("could not reach https://rpc.example.com/x")), /https:\/\/rpc\.example\.com\/x/);
  const raw = "0x02f8ae" + "ab".repeat(150);
  const rpcErr = publicError(new Error(`could not coalesce error (error={ "code": -32000, "message": "send rejected" }, payload={ "method": "eth_sendRawTransaction", "params": [ "${raw}" ] }, code=UNKNOWN_ERROR)`));
  assert.equal(rpcErr, "could not coalesce error"); assert.ok(!rpcErr.includes("0x02f8"));
  assert.ok(!publicError(new Error(`bad ${raw}`)).includes("abab"));
});

test("paid tools reject unknown arguments with INPUT_INVALID and echo no names or values", async () => {
  const { unknownPaidArgs } = await import("./tools.js");
  const secret = "fake-wif-not-a-real-key-0000"; // not a secret: test fixture
  const m = unknownPaidArgs("veya_paid_call", { taskId: "t", idempotencyKey: "k".repeat(8), input: {}, [secret]: secret, secretKey: secret })!;
  assert.match(m, /^INPUT_INVALID: 2 unknown argument/); assert.ok(!m.includes(secret) && !m.includes("secretKey"));
  assert.equal(unknownPaidArgs("veya_paid_call", { taskId: "t", idempotencyKey: "kkkkkkkk", input: {}, apiKey: "x", solanaPrivateKey: "x", robinhoodPrivateKey: "y", environmentUuid: "z" }), null);
  assert.match(unknownPaidArgs("veya_paid_call", { taskId: "t", idempotencyKey: "kkkkkkkk", input: {}, payerPrivateKey: "x" })!, /INPUT_INVALID: 1 unknown/);
  assert.match(unknownPaidArgs("veya_paid_run", { runId: "r", extra: 1 })!, /INPUT_INVALID/);
  assert.match(unknownPaidArgs("veya_paid_discover", { a: 1 })!, /INPUT_INVALID/);
  assert.equal(unknownPaidArgs("veya_describe", { a: 1 }), null);
});

test("strict args are enforced end-to-end through an MCP client", async () => {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { registerPaidCallTools } = await import("./tools.js");
  let touched = 0;
  const { g } = guardNoOperator(() => touched++);
  const server = new McpServer({ name: "t", version: "1" });
  registerPaidCallTools(server, g, (g as any).d.cfg, { accounts: fakeAccounts(), sponsors: new Map() });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); const c = new Client({ name: "c", version: "1" }); await c.connect(b);
  const r: any = await c.callTool({ name: "veya_paid_call", arguments: { taskId: "t", idempotencyKey: "idem-strict-1", input: { assetId: "solana" }, secretKey: "SECRETVALUE123" } });
  const txt = r.content[0].text; assert.equal(r.isError, true); assert.match(txt, /INPUT_INVALID: 1 unknown argument/); assert.ok(!txt.includes("SECRETVALUE123") && !txt.includes("secretKey"));
  assert.equal(touched, 0); assert.equal(g.ledger.runByIdem("idem-strict-1"), undefined);
  const ok: any = await c.callTool({ name: "veya_paid_call", arguments: { taskId: "t", idempotencyKey: "idem-strict-2", input: { assetId: "solana" } } });
  assert.match(ok.content[0].text, /API_KEY_REQUIRED/);
  const ok2: any = await c.callTool({ name: "veya_paid_call", arguments: { apiKey: KEY_A, taskId: "t", idempotencyKey: "idem-strict-2", input: { assetId: "solana" } } });
  assert.match(ok2.content[0].text, /SOLANA_KEY_REQUIRED/);
  await c.close();
});

test("tools/list: apiKey and both wallet keys required; all paid schemas closed", async () => {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { registerPaidCallTools } = await import("./tools.js");
  const list = async (g: any) => {
    const server = new McpServer({ name: "t", version: "1" }); registerPaidCallTools(server, g, g.d.cfg, { accounts: fakeAccounts(), sponsors: new Map() });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a);
    const c = new Client({ name: "c", version: "1" }); await c.connect(b);
    const tools = (await c.listTools()).tools; await c.close(); return Object.fromEntries(tools.map((t: any) => [t.name, t.inputSchema]));
  };
  const { g } = guardNoOperator(() => {});
  const hosted = await list(g);
  for (const k of ["apiKey", "solanaPrivateKey", "robinhoodPrivateKey", "taskId", "idempotencyKey", "input"]) assert.ok(hosted.veya_paid_call.required.includes(k), k);
  assert.ok(hosted.veya_paid_run.required.includes("apiKey"));
  for (const n of ["veya_paid_discover", "veya_paid_call", "veya_paid_run"]) assert.equal(hosted[n].additionalProperties, false, n);
});

test("publicError drops ethers' detail tail (signed tx hex, info)", async () => {
  const { publicError } = await import("./pipeline.js");
  assert.equal(publicError(new Error('insufficient funds for intrinsic transaction cost (transaction="0x02f8ae", info={ "error": {} }, code=INSUFFICIENT_FUNDS, version=6.17.0)')), "insufficient funds for intrinsic transaction cost");
  assert.equal(publicError(new Error("ANCHOR_NOT_CONFIGURED")), "ANCHOR_NOT_CONFIGURED");
});
