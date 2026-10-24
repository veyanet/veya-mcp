import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, it, before, after } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig, type McpServiceConfig } from "./config.js";
import { createHttpApp } from "./http.js";
import { verifyTransactionTool, publicClientConfig } from "./tools/public.js";
import { normalizeSealProof } from "./tools/sealDecision.js";
import { wantsHtml } from "./mcpInfoPage.js";

const KEY = "veya_dev_abc_secret";

describe("fixes2 mcp", () => {
  let api: http.Server, mcp: http.Server, base = "";
  const seen: Array<{ path: string; body: unknown; auth: string }> = [];
  let cfg: McpServiceConfig;

  before(async () => {
    api = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        seen.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : null, auth: String(req.headers.authorization ?? "") });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((r) => api.listen(0, "127.0.0.1", () => r()));
    process.env.ROBINHOOD_NETWORK = "testnet";
    process.env.VEYA_API_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    cfg = loadConfig();
    mcp = createHttpApp(cfg).listen(0, "127.0.0.1");
    await new Promise((r) => mcp.once("listening", r));
    base = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;
  });
  after(() => { api.close(); mcp.close(); });

  async function client() {
    const c = new Client({ name: "fixes2-test", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    return c;
  }

  it("real MCP client: initialize + tools/list still work on POST /mcp", async () => {
    const c = await client();
    const { tools } = await c.listTools();
    assert.ok(tools.length >= 50, `tools=${tools.length}`);
    assert.ok(tools.some((t) => t.name === "veya_run_protected_execution"));
    await c.close();
  });

  // Bug 2: no caller-controlled fleet URLs on any tool
  it("no tool accepts caller URLs for validators / sealed node (SSRF)", async () => {
    const c = await client();
    const { tools } = await c.listTools();
    for (const t of tools) {
      const props = Object.keys((t.inputSchema as { properties?: object }).properties ?? {});
      for (const bad of ["nodeUrls", "sealedNodeUrl", "validatorUrls", "nodeUrl", "url"]) {
        assert.ok(!props.includes(bad), `${t.name} exposes ${bad}`);
      }
    }
    await c.close();
  });

  // Bug 3: policy + memory need a key and go to the key-scoped API
  it("policy and memory tools refuse without apiKey and forward the key otherwise", async () => {
    const c = await client();
    const env = "00000000-0000-4000-8000-000000000001";
    const calls: Array<[string, Record<string, unknown>]> = [
      ["veya_set_tool_policy", { environmentId: env, agentId: "a", tool: "x", allowed: true }],
      ["veya_route_message", { environmentId: env, id: "1", fromAgent: "a", toAgent: "b", tool: "x", payload: {} }],
      ["veya_store_memory", { environmentId: env, agentId: "a", data: "d" }],
      ["veya_read_memory", { environmentId: env, id: "m" }],
    ];
    for (const [name, args] of calls) {
      const before = seen.length;
      const r = (await c.callTool({ name, arguments: args })) as { isError?: boolean };
      assert.equal(r.isError, true, `${name} without key must error`);
      assert.equal(seen.length, before, `${name} without key must not reach the API`);
      await c.callTool({ name, arguments: { ...args, apiKey: KEY } });
      const last = seen[seen.length - 1];
      assert.match(last.auth, /veya_dev_abc_secret/, `${name} must send the caller key`);
      assert.match(last.path, new RegExp(`/v1/environments/${env}/`));
    }
    await c.close();
  });

  // Bug 1: MCP sends API field names
  it("run_protected_execution sends discloseFields/sealFields", async () => {
    const c = await client();
    await c.callTool({ name: "veya_run_protected_execution", arguments: {
      apiKey: KEY, environmentId: "e", agentId: "a", eventType: "t", payload: { a: 1, s: 2 }, disclose: ["a"], seal: ["s"] } });
    const last = seen[seen.length - 1];
    assert.match(last.path, /executions\/protected$/);
    assert.deepEqual((last.body as { discloseFields: string[] }).discloseFields, ["a"]);
    assert.deepEqual((last.body as { sealFields: string[] }).sealFields, ["s"]);
    await c.close();
  });

  // Bug 4
  it("seal_decision: sealed.transaction mirrors chain.txHash", () => {
    const tx = "0x" + "ab".repeat(32);
    const proof = { ok: true, evidenceId: "e", sealed: { fingerprint: "f", runtime: "AES-256-GCM", transaction: null },
      attestation: {} as never, chain: { txHash: tx } as never } as const;
    const n = normalizeSealProof(proof as never) as { sealed: { transaction: string | null } };
    assert.equal(n.sealed.transaction, tx);
    const noChain = normalizeSealProof({ ...proof, chain: null } as never) as { sealed: { transaction: string | null } };
    assert.equal(noChain.sealed.transaction, null);
  });

  // Bug 6
  it("verify_transaction returns NOT_VEYA_TX instead of bare null", async () => {
    const r = await verifyTransactionTool(cfg, "0x" + "11".repeat(32), async () => null);
    const body = JSON.parse(r.content[0].text) as { ok: boolean; code: string; message: string };
    assert.equal(r.isError, true); assert.equal(body.ok, false); assert.equal(body.code, "NOT_VEYA_TX"); assert.ok(body.message.length > 10);
    const bad = JSON.parse((await verifyTransactionTool(cfg, "0x12", async () => null)).content[0].text) as { code: string };
    assert.equal(bad.code, "INVALID_TX_HASH");
    const good = await verifyTransactionTool(cfg, "0x" + "22".repeat(32), async () => ({ verified: true }));
    assert.equal(good.isError, undefined);
  });

  // Bug 9 + info page
  it("/healthz equals /health; GET /mcp from a browser shows the setup page; SSE GET untouched", async () => {
    const h = await (await fetch(`${base}/health`)).json();
    const hz = await (await fetch(`${base}/healthz`)).json();
    assert.deepEqual(hz, h);
    const page = await fetch(`${base}/mcp`, { headers: { Accept: "text/html,application/xhtml+xml" } });
    assert.equal(page.status, 200);
    const t = await page.text();
    assert.match(t, /Connect your agent/); assert.match(t, /Cursor/); assert.match(t, /Claude/); assert.match(t, /Codex/);
    assert.match(t, /Testnet/);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    const c2 = await client(); const n = (await c2.listTools()).tools.length; await c2.close();
    assert.match(t, new RegExp(`<span class="label">Tools</span><b>${n}</b>`));
    assert.ok(t.includes(`<b>${pkg.version}</b>`), "version comes from package.json");
    assert.ok(!/46630|4663\b|prisma|sqlite|#0F0B1E|background:#000/i.test(t));
    assert.ok(t.includes("/assets/veya-logo.png"));
    assert.match(t, /Get your key from/); assert.match(t, /System<\/b>, open <b>API Keys/); assert.match(t, /"apiKey"/);
    assert.equal((t.match(/<details/g) ?? []).length, 8); assert.ok(!t.includes("${"));
    assert.ok(t.includes('id="veya-grad-mcpnetwork"'), "real landing SVG icons");
    const logo = await fetch(`${base}/assets/veya-logo.png`);
    assert.equal(logo.headers.get("content-type"), "image/png");
    assert.equal(createHash("sha256").update(Buffer.from(await logo.arrayBuffer())).digest("hex").length, 64);
    assert.ok(!/127\.0\.0\.1|localhost|pricing|price/i.test(t));
    assert.equal(wantsHtml("text/event-stream"), false);
    assert.equal(wantsHtml("application/json, text/event-stream"), false);
    const root = await (await fetch(`${base}/`)).text();
    assert.match(root, /Inter/); assert.match(root, /Set up your client/);
    assert.ok(!/127\.0\.0\.1|localhost|46630|pricing|free/i.test(root));
  });

  it("ping_chain config hides fleet URLs; health settlement has no chain id; sealed is plain AES-256-GCM", async () => {
    const c = publicClientConfig({ network: "testnet", validatorNodes: ["http://127.0.0.1:7701", "http://127.0.0.1:7702"], sealedNodeUrl: "http://127.0.0.1:7800" });
    assert.ok(!JSON.stringify(c).includes("127.0.0.1")); assert.equal(c.validators, 2); assert.equal(c.sealedNodeConfigured, true);
    const h = (await (await fetch(`${base}/health`)).json()) as { settlement: string; sealed: string; chainId?: number };
    assert.equal(h.settlement, "Robinhood Chain testnet"); assert.equal(h.sealed, "AES-256-GCM"); assert.equal(h.chainId, undefined);
  });
});
