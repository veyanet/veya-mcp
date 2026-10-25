/**
 * Minimal MCP client example for VEYA Paid Call Guard: your VEYA API key, your Solana wallet, your Robinhood Chain wallet.
 * Run from the mcp/ folder:
 *   VEYA_API_KEY_FILE=./veya-api-key.txt SOLANA_KEY_FILE=./my-solana-keypair.json ROBINHOOD_KEY_FILE=./my-robinhood.key \
 *     npx tsx scripts/paid-call-example.mts
 * Without PAID_CONFIRM=1 it only reads (discover), shows one blocked call and lists your saved runs. Nothing is paid.
 * With PAID_CONFIRM=1 it makes one real paid call: USDC from the Solana wallet, record gas from the Robinhood Chain wallet.
 * Optional: VEYA_MCP_URL (default the hosted endpoint), VEYA_MCP_TOKEN (only if the host requires one),
 *           PAID_RESOURCE (default tokens.asset-risk-summary), PAID_INPUT (JSON, default {"assetId":"solana"}),
 *           PAID_TASK_ID, PAID_IDEMPOTENCY_KEY (default: a new UUID; reuse it to retry safely).
 * Key files are read into memory and sent only as tool arguments. They are never printed.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.VEYA_MCP_URL ?? "https://mcp.veyanet.tech/mcp";
const headers: Record<string, string> = process.env.VEYA_MCP_TOKEN ? { Authorization: `Bearer ${process.env.VEYA_MCP_TOKEN}` } : {};
const file = (name: string) => (process.env[name] ? readFileSync(process.env[name]!, "utf8").trim() : undefined);
const apiKey = file("VEYA_API_KEY_FILE");
const solanaPrivateKey = file("SOLANA_KEY_FILE");
const robinhoodPrivateKey = file("ROBINHOOD_KEY_FILE");

const client = new Client({ name: "example-agent", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);

// 1) Read-only: which paid resources does policy allow, what does one call take, which input do they need?
const discover = text(await client.callTool({ name: "veya_paid_discover", arguments: {} }));
console.log(JSON.stringify(discover.resources.map((r: any) => ({ id: r.id, payer: r.payer, input: r.input, policyPreview: r.policyPreview })), null, 2));

const taskId = process.env.PAID_TASK_ID ?? `task-${randomUUID()}`;
const resourceId = process.env.PAID_RESOURCE ?? "tokens.asset-risk-summary";
const input = process.env.PAID_INPUT ? JSON.parse(process.env.PAID_INPUT) : { assetId: "solana" };
if (!apiKey || !solanaPrivateKey || !robinhoodPrivateKey) {
  console.log("Set VEYA_API_KEY_FILE, SOLANA_KEY_FILE and ROBINHOOD_KEY_FILE to try calls (a missing one returns API_KEY_REQUIRED, SOLANA_KEY_REQUIRED or ROBINHOOD_KEY_REQUIRED).");
  await client.close(); process.exit(0);
}
const keys = { apiKey, solanaPrivateKey, robinhoodPrivateKey };

// 2) A call the policy blocks (task budget below the call amount). Nothing is signed.
const blocked = text(await client.callTool({ name: "veya_paid_call", arguments: { taskId: `${taskId}-blocked`, idempotencyKey: randomUUID(), resourceId, input, taskBudgetAtomic: "1", ...keys } }));
console.log("blocked example:", blocked.decision, blocked.reason, "saved to account:", blocked.account?.saved);

if (process.env.PAID_CONFIRM !== "1") {
  const runs = text(await client.callTool({ name: "veya_paid_run", arguments: { apiKey } }));
  console.log("runs saved to your account:", (runs.paidRuns ?? []).length);
  console.log("Set PAID_CONFIRM=1 to make one real paid call."); await client.close(); process.exit(0);
}

// 3) One paid call. Reuse the same idempotencyKey to retry safely: it never pays twice.
const idempotencyKey = process.env.PAID_IDEMPOTENCY_KEY ?? randomUUID();
console.log("idempotencyKey:", idempotencyKey);
const result = text(await client.callTool({ name: "veya_paid_call", arguments: { taskId, idempotencyKey, resourceId, input, ...keys } }, undefined, { timeout: 180_000 }));
console.log(result.decision, result.state, result.reason);
console.log({ payment: result.payment?.solscan, veyaRecord: result.veya?.blockscout, from: result.veya?.from, receipt: result.receipt, account: result.account });

// 4) Read the run later from your account (never pays).
if (result.runId) console.log(text(await client.callTool({ name: "veya_paid_run", arguments: { apiKey, runId: result.runId } })).state);
await client.close();
