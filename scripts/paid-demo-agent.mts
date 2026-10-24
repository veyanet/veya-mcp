/** Demo agent: talks to a VEYA MCP server with paid calls enabled, like any MCP client. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL!);
const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${process.env.MCP_API_KEY}` } } });
const client = new Client({ name: "veya-paid-demo-agent", version: "1.0.0" });
await client.connect(transport);
const show = (title: string, v: unknown) => console.log(`\n=== ${title} ===\n` + (typeof v === "string" ? v : JSON.stringify(v, null, 2)));
const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
  return JSON.parse(r.content[0].text);
};
const MINT = process.env.DEMO_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC mint
const RESOURCE = process.env.DEMO_RESOURCE ?? "tokens.risk-summary";
const INPUT = process.env.DEMO_INPUT ? JSON.parse(process.env.DEMO_INPUT) : { mint: MINT };
const TAG = process.env.DEMO_TAG ?? String(Date.now());

const tools = (await client.listTools()).tools.map((t) => t.name);
show("Paid-call tools the agent sees", tools.filter((t) => t.startsWith("veya_paid_")));
show("Any wallet/transfer/swap/trade tool exposed?", tools.filter((t) => /transfer|swap|trade|xpay|bridge/i.test(t)).length ? "YES (bad)" : "none");

show("1) discover (read-only, unpaid quote)", await call("veya_paid_discover", {}));

show("2) BLOCKED: resource on a host outside policy", await call("veya_paid_call", {
  taskId: `demo-${TAG}`, idempotencyKey: `demo-blocked-host-${TAG}`, resourceId: "other.resource", url: "https://api.example.com/x402/other-resource", input: { mint: MINT },
}));
show("3) BLOCKED: over the task budget", await call("veya_paid_call", {
  taskId: `demo-small-${TAG}`, idempotencyKey: `demo-over-budget-${TAG}`, resourceId: "tokens.risk-summary", input: { mint: MINT }, taskBudgetAtomic: "15000",
}));
if (process.env.DEMO_PAY === "1") {
  const r = await call("veya_paid_call", { taskId: process.env.DEMO_TASK ?? `demo-${TAG}`, idempotencyKey: process.env.DEMO_IDEM ?? `demo-allowed-${TAG}`, resourceId: RESOURCE, input: INPUT });
  show("4) ALLOWED: paid call, verified and recorded", r);
} else show("4) ALLOWED call skipped", "set DEMO_PAY=1 to run one real paid call");
await client.close();
