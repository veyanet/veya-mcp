import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";

const KEY = "veya_dev_abc_secret";
const TABLE = { enabled: true, token: { symbol: "VEYA", chain: "Robinhood Chain" }, tiers: [{ id: "base", name: "Base", minBalance: 0, limits: { dailyActions: 2000 } }] };
const TIER = { tier: { id: "holder", name: "Holder", rank: 1 }, balance: 2_839_883, source: "chain", limits: { dailyActions: 5000, dailyReceipts: 250, receiptHistoryDays: 365 } };

describe("veya_tier", () => {
  let api: http.Server, mcp: http.Server, base = "";
  const seen: Array<{ path: string; auth: string }> = [];
  let status = 200;

  before(async () => {
    api = http.createServer((req, res) => {
      seen.push({ path: req.url ?? "", auth: String(req.headers.authorization ?? "") });
      res.setHeader("content-type", "application/json");
      res.statusCode = status;
      if (req.url === "/public/holder-tiers") return res.end(JSON.stringify(TABLE));
      if (req.url === "/v1/holder/tier") {
        if (status === 429) return res.end(JSON.stringify({ error: "Daily actions limit reached for the Holder tier (5000 per UTC day). Nothing was sent.", code: "DAILY_LIMIT", tier: "holder" }));
        return res.end(JSON.stringify(TIER));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not found" }));
    });
    await new Promise<void>((r) => api.listen(0, "127.0.0.1", () => r()));
    process.env.ROBINHOOD_NETWORK = "testnet";
    process.env.VEYA_API_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    mcp = createHttpApp(loadConfig()).listen(0, "127.0.0.1");
    await new Promise((r) => mcp.once("listening", r));
    base = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;
  });
  after(() => { api.close(); mcp.close(); });

  async function callTier(args: Record<string, unknown>) {
    const c = new Client({ name: "tier-test", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const r = (await c.callTool({ name: "veya_tier", arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    await c.close();
    return { isError: !!r.isError, json: JSON.parse(r.content[0].text) };
  }

  it("is listed with apiKey and sessionToken inputs", async () => {
    const c = new Client({ name: "tier-test", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const t = (await c.listTools()).tools.find((x) => x.name === "veya_tier");
    await c.close();
    assert.ok(t, "veya_tier listed");
    assert.match(t!.description ?? "", /\$VEYA/);
    assert.deepEqual(Object.keys((t!.inputSchema as { properties: object }).properties).sort(), ["apiKey", "sessionToken"]);
  });

  it("without a key returns the public tier table and sends no credential", async () => {
    seen.length = 0;
    const r = await callTier({});
    assert.equal(r.isError, false);
    assert.equal(r.json.httpStatus, 200);
    assert.equal(r.json.body.tiers[0].id, "base");
    assert.equal(seen[0].path, "/public/holder-tiers");
    assert.equal(seen[0].auth, "");
  });

  it("with a key returns your tier from /v1/holder/tier", async () => {
    seen.length = 0;
    const r = await callTier({ apiKey: KEY });
    assert.equal(r.isError, false);
    assert.equal(r.json.body.tier.id, "holder");
    assert.equal(r.json.body.limits.dailyActions, 5000);
    assert.equal(seen[0].path, "/v1/holder/tier");
    assert.equal(seen[0].auth, `Bearer ${KEY}`);
    assert.ok(!JSON.stringify(r.json).includes(KEY), "key never echoed");
  });

  it("a limit error is an MCP error that names the tier", async () => {
    status = 429;
    try {
      const r = await callTier({ apiKey: KEY });
      assert.equal(r.isError, true);
      assert.equal(r.json.httpStatus, 429);
      assert.equal(r.json.body.code, "DAILY_LIMIT");
      assert.equal(r.json.body.tier, "holder");
    } finally {
      status = 200;
    }
  });
});
