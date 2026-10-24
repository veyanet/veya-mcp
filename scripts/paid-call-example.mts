/**
 * Minimal MCP client example for VEYA Paid Call Guard.
 * Run from the mcp/ folder:  VEYA_MCP_URL=... VEYA_MCP_TOKEN=... npx tsx scripts/paid-call-example.mts
 * Without PAID_CONFIRM=1 it only reads (discover) and shows one blocked call. Nothing is paid.
 * With PAID_CONFIRM=1 it makes one real paid call.
 * Optional: PAID_RESOURCE (default tokens.risk-summary), PAID_INPUT (JSON, default the USDC mint),
 *           PAID_TASK_ID, PAID_IDEMPOTENCY_KEY (default: a new UUID; reuse it to retry safely).
 */
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "example-agent", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.VEYA_MCP_URL!), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.VEYA_MCP_TOKEN}` } },
}));
const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);

// 1) Read-only: which paid resources does policy allow, what do they cost, which input do they take?
const discover = text(await client.callTool({ name: "veya_paid_discover", arguments: {} }));
console.log(JSON.stringify(discover.resources.map((r: any) => ({ id: r.id, payer: r.payer, input: r.input, policyPreview: r.policyPreview })), null, 2));

const taskId = process.env.PAID_TASK_ID ?? `task-${randomUUID()}`;
const resourceId = process.env.PAID_RESOURCE ?? "tokens.risk-summary";
const input = process.env.PAID_INPUT ? JSON.parse(process.env.PAID_INPUT) : { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" };

// 2) A call the policy blocks (task budget below the cost). Nothing is signed.
const blocked = text(await client.callTool({ name: "veya_paid_call", arguments: { taskId: `${taskId}-blocked`, idempotencyKey: randomUUID(), resourceId, input, taskBudgetAtomic: "1" } }));
console.log("blocked example:", blocked.decision, blocked.reason);

if (process.env.PAID_CONFIRM !== "1") { console.log("Set PAID_CONFIRM=1 to make one real paid call."); await client.close(); process.exit(0); }

// 3) One paid call. Reuse the same idempotencyKey to retry safely: it never pays twice.
const idempotencyKey = process.env.PAID_IDEMPOTENCY_KEY ?? randomUUID();
console.log("idempotencyKey:", idempotencyKey);
const result = text(await client.callTool({ name: "veya_paid_call", arguments: { taskId, idempotencyKey, resourceId, input } }));
console.log(result.decision, result.state, result.reason);
console.log({ payment: result.payment?.solscan, veyaRecord: result.veya?.blockscout, receipt: result.receipt });

// 4) Read the run later (never pays).
if (result.runId) console.log(text(await client.callTool({ name: "veya_paid_run", arguments: { runId: result.runId } })).state);
await client.close();
