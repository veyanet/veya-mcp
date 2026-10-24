/**
 * Full-stack check over real MCP transports (HTTP + stdio). Never pays: the MCP under test is started
 * WITHOUT a Solana key, so any attempt to pay fails closed. Do not point it at a server that has a payer
 * key: the "no payer key" step is allowed by policy and would make one real paid call there. Optional "allowed" step: an idempotent replay
 * of an already-committed run (REPLAY_TASK, REPLAY_IDEM, REPLAY_INPUT, REPLAY_RUN), which never pays again.
 * Env: MCP_URL, MCP_TOKEN (HTTP); STDIO_CMD="node dist/cli.js --stdio" (stdio); STDIO_STATE_DIR (separate state folder for the stdio server when an HTTP server is running); TAG.
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TAG = process.env.TAG ?? String(Date.now());
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const GATED = ["veya_paid_discover", "veya_paid_call", "veya_paid_run"];
const FORBIDDEN = /(^|_)(do|transfer|swap|trade|bridge)(_|$)|xpay|forclaude|foropenai|forgemini/i;
const out = (s: string, v?: unknown) => console.log(`\n=== ${s} ===` + (v === undefined ? "" : "\n" + JSON.stringify(v, null, 2)));

async function exercise(name: string, client: Client, expectPaid: boolean) {
  const tools = (await client.listTools()).tools.map((t) => t.name);
  const paid = tools.filter((t) => t.startsWith("veya_paid_"));
  out(`${name}: tools/list`, { total: tools.length, paidTools: paid, forbiddenNames: tools.filter((t) => FORBIDDEN.test(t)) });
  assert.equal(tools.filter((t) => FORBIDDEN.test(t)).length, 0, "no transfer/swap/trade/do/xpay tools");
  if (!expectPaid) { assert.equal(paid.length, 0, "paid-call tools hidden when VEYA_PAID_CALLS is off"); return; }
  assert.deepEqual([...paid].sort(), [...GATED].sort());
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r: any = await client.callTool({ name: tool, arguments: args });
    return JSON.parse(r.content[0].text);
  };
  const health = await call("veya_api_health", {}).catch((e) => ({ error: String(e) }));
  out(`${name}: veya_api_health (local backend)`, health);
  const d = await call("veya_paid_discover", {}); out(`${name}: discover`, d);
  const host = await call("veya_paid_call", { taskId: `e2e-${name}-${TAG}`, idempotencyKey: `e2e-${name}-host-${TAG}`, resourceId: "other.resource", url: "https://api.example.com/x402/other-resource", input: { mint: USDC } });
  out(`${name}: blocked host`, host); assert.equal(host.decision, "blocked"); assert.match(host.reason, /HOST_NOT_ALLOWED|RESOURCE_NOT_ALLOWED/);
  const budget = await call("veya_paid_call", { taskId: `e2e-${name}-small-${TAG}`, idempotencyKey: `e2e-${name}-budget-${TAG}`, resourceId: "tokens.risk-summary", input: { mint: USDC }, taskBudgetAtomic: "15000" });
  out(`${name}: blocked budget`, budget); assert.equal(budget.decision, "blocked"); assert.match(budget.reason, /OVER_TASK_BUDGET/);
  const bad = await call("veya_paid_call", { taskId: `e2e-${name}-${TAG}`, idempotencyKey: `e2e-${name}-bad-${TAG}`, resourceId: "tokens.risk-summary", input: { mint: "not-a-mint!" } }).catch((e) => ({ error: String(e) }));
  out(`${name}: bad input`, bad); assert.match(bad.reason, /INPUT_INVALID/);
  const nokey = await call("veya_paid_call", { taskId: `e2e-${name}-nokey-${TAG}`, idempotencyKey: `e2e-${name}-nokey-${TAG}`, resourceId: "tokens.asset-risk-summary", input: { assetId: "solana" } });
  out(`${name}: allowed by policy but no payer key on this server (fails closed, nothing paid)`, nokey); assert.equal(nokey.state, "payment_failed"); assert.match(nokey.reason, /PAYER_NOT_CONFIGURED/);
  if (!process.env.REPLAY_IDEM) return;
  const replay = await call("veya_paid_call", { taskId: process.env.REPLAY_TASK, idempotencyKey: process.env.REPLAY_IDEM, input: JSON.parse(process.env.REPLAY_INPUT ?? '{"mint":"' + USDC + '"}') });
  out(`${name}: allowed (idempotent replay of committed run, no new payment)`, replay);
  assert.equal(replay.state, "committed"); assert.equal(replay.replay, true); assert.equal(replay.runId, process.env.REPLAY_RUN);
  const run = await call("veya_paid_run", { runId: process.env.REPLAY_RUN }); out(`${name}: veya_paid_run`, { state: run.state, statuses: run.statuses, receipt: run.receipt });
}

if (process.env.MCP_URL) {
  const c = new Client({ name: "veya-paid-e2e-http", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${process.env.MCP_TOKEN ?? process.env.MCP_API_KEY}` } } }));
  await exercise("http", c, true); await c.close();
}
if (process.env.STDIO_CMD) {
  const [cmd, ...args] = process.env.STDIO_CMD.split(" ");
  for (const on of [true, false]) {
    const env = { ...process.env, VEYA_PAID_CALLS: on ? "1" : "0" } as Record<string, string>;
    delete env.VEYA_PAID_SOLANA_KEY_PATH; delete env.VEYA_PAID_ANCHOR_KEY_PATH;
    if (process.env.STDIO_STATE_DIR) env.VEYA_PAID_STATE_DIR = process.env.STDIO_STATE_DIR; // one writer per state folder
    const c = new Client({ name: "veya-paid-e2e-stdio", version: "1.0.0" });
    await c.connect(new StdioClientTransport({ command: cmd, args, env, stderr: "ignore" }));
    await exercise(on ? "stdio" : "stdio-paid-off", c, on); await c.close();
  }
}
console.log("\nE2E OK");
