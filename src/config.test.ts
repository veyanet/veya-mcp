import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig, writesEnabled, MCP_SERVICE_NAME } from "./config.js";
import { createHttpApp } from "./http.js";

describe("veyanet mcp config", () => {
  it("defaults to testnet 46630", () => {
    delete process.env.ROBINHOOD_CHAIN_ID;
    const cfg = loadConfig();
    assert.equal(cfg.chainId, 46630);
    assert.match(cfg.contractAddress, /^0x1a1D/i);
  });

  it("writes disabled without keys", () => {
    delete process.env.MCP_API_KEY;
    delete process.env.VEYA_RELAYER_PRIVATE_KEY;
    delete process.env.VEYA_DEPLOYER_PRIVATE_KEY;
    const cfg = loadConfig();
    assert.equal(writesEnabled(cfg), false);
  });
});

describe("veyanet mcp http", () => {
  it("GET /health returns honesty fields", async () => {
    const cfg = loadConfig();
    cfg.port = 0;
    const app = createHttpApp(cfg);
    const server = app.listen(0);
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr === "object");
      const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.service, MCP_SERVICE_NAME);
      assert.equal(body.chainId, 46630);
      assert.match(String(body.sealed), /AES-256-GCM/);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
