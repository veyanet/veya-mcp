import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";
import { ToolStats, publicToolLabel, toolCallNames } from "./toolStats.js";

const KNOWN = new Set(["veya_describe", "veya_hash_blake3", "veya_paid_call"]);

describe("tool stats", () => {
  it("reads tool names from single and batch tools/call bodies, registered names only", () => {
    assert.deepEqual(toolCallNames({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "veya_describe" } }, KNOWN), ["veya_describe"]);
    assert.deepEqual(
      toolCallNames(
        [
          { method: "tools/call", params: { name: "veya_hash_blake3", arguments: { secret: "x" } } },
          { method: "tools/list" },
          { method: "tools/call", params: { name: "made_up_tool" } },
          { method: "initialize" },
        ],
        KNOWN,
      ),
      ["veya_hash_blake3"],
    );
    assert.deepEqual(toolCallNames(null, KNOWN), []);
    assert.deepEqual(toolCallNames("tools/call", KNOWN), []);
  });

  it("groups billing-named tools under one public label", () => {
    assert.equal(publicToolLabel("veya_paid_call"), "metered_calls");
    assert.equal(publicToolLabel("veya_paid_discover"), "metered_calls");
    assert.equal(publicToolLabel("veya_prove"), "veya_prove");
  });

  it("windows, daily series, file round trip and pruning", () => {
    const dir = mkdtempSync(join(tmpdir(), "veya-tool-stats-"));
    try {
      const now = new Date("2026-10-31T10:30:00Z");
      const s = new ToolStats(dir);
      s.record("veya_describe", now);
      s.record("veya_describe", new Date("2026-10-30T11:10:00Z"));
      s.record("veya_paid_call", new Date("2026-10-30T10:00:00Z"));
      s.record("veya_hash_blake3", new Date("2026-10-20T00:00:00Z"));
      s.record("veya_hash_blake3", new Date("2026-08-01T00:00:00Z")); // older than 35 days
      s.save(now);
      const onDisk = JSON.parse(readFileSync(join(dir, "tool-stats.json"), "utf8"));
      assert.equal(onDisk.archivedTotal, 1);
      assert.equal(Object.keys(onDisk.hours).length, 4);
      assert.ok(!JSON.stringify(onDisk).includes("arguments"));

      const again = new ToolStats(dir).summary(now);
      assert.deepEqual(again.toolCalls, { total: 5, last24h: 2, last7d: 3, last30d: 4 });
      assert.equal(again.daily.length, 30);
      assert.equal(again.daily[29].date, "2026-10-31");
      assert.equal(again.daily[29].count, 1);
      assert.equal(again.daily[28].count, 2);
      assert.deepEqual(again.topTools7d, [
        { tool: "veya_describe", count: 2 },
        { tool: "metered_calls", count: 1 },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("over HTTP", () => {
    let api: http.Server, mcp: http.Server, base = "";
    let s: ToolStats;

    before(async () => {
      api = http.createServer((_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      });
      await new Promise<void>((r) => api.listen(0, "127.0.0.1", () => r()));
      process.env.ROBINHOOD_NETWORK = "testnet";
      process.env.VEYA_API_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
      s = new ToolStats(null);
      mcp = createHttpApp(loadConfig(), { toolStats: s }).listen(0, "127.0.0.1");
      await new Promise((r) => mcp.once("listening", r));
      base = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;
    });
    after(() => {
      api.close();
      mcp.close();
    });

    it("counts tools/call through a real client and serves GET /stats with counts only", async () => {
      const c = new Client({ name: "tool-stats-test", version: "1.0.0" });
      await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      await c.listTools();
      await c.callTool({ name: "veya_hash_blake3", arguments: { data: "hello" } });
      await c.callTool({ name: "veya_hash_blake3", arguments: { data: "again" } });
      await c.callTool({ name: "veya_describe", arguments: {} });
      await c.close();

      // Rejected by the transport (no event-stream in Accept): not a call.
      const rejected = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "veya_describe", arguments: {} } }),
      });
      assert.ok(rejected.status >= 400, `status ${rejected.status}`);
      await rejected.text();

      const res = await fetch(`${base}/stats`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        toolCalls: { total: number; last24h: number };
        topTools7d: { tool: string; count: number }[];
        daily: unknown[];
      };
      assert.equal(body.toolCalls.total, 3);
      assert.equal(body.toolCalls.last24h, 3);
      assert.deepEqual(body.topTools7d, [
        { tool: "veya_hash_blake3", count: 2 },
        { tool: "veya_describe", count: 1 },
      ]);
      assert.equal(body.daily.length, 30);
      const text = JSON.stringify(body).toLowerCase();
      for (const banned of ["hello", "again", "chainid", "rpc", "0x", "localhost", "127.0.0.1", "paid", "free"]) {
        assert.ok(!text.includes(banned), `/stats must not include ${banned}`);
      }
    });
  });
});
