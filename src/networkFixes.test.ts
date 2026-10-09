import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiRequest } from "./api.js";
import { resolveMcpSealEnvironment } from "./tools/sealDecision.js";

describe("network header and seal environment", () => {
  it("sends X-Veya-Network on each API call", async () => {
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push(headers["X-Veya-Network"] ?? "");
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const cfg = {
        port: 1,
        host: "127.0.0.1",
        publicMcpUrl: "http://127.0.0.1/mcp",
        network: "mainnet" as const,
        chainId: 4663,
        rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
        explorerUrl: "https://robinhoodchain.blockscout.com",
        contractAddress: "0x87dC582eEA544A434a5C1e30Ca3d12c1e548a674",
        apiUrl: "http://127.0.0.1:8791",
        mcpApiKey: null,
        relayerPrivateKey: null,
        payerPrivateKey: null,
        validatorNodes: [],
        sealedNodeUrl: "http://127.0.0.1:7800",
        sealDecisionEnvironmentId: null,
        sealDecisionRelayer: false,
        corsOrigins: [],
        nodeEnv: "test",
      };
      await apiRequest(cfg, "/health");
      await apiRequest({ ...cfg, network: "testnet" }, "/v1/environments");
      assert.deepEqual(seen, ["mainnet", "testnet"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("requires an environment on mainnet and keeps the testnet default", () => {
    assert.equal(resolveMcpSealEnvironment("mainnet", undefined, null), null);
    assert.equal(
      resolveMcpSealEnvironment("mainnet", "7d0af0ba-2ae3-4d0e-bc75-0bbaccb3dd71", null),
      "7d0af0ba-2ae3-4d0e-bc75-0bbaccb3dd71",
    );
    assert.equal(
      resolveMcpSealEnvironment("mainnet", undefined, "11111111-1111-1111-1111-111111111111"),
      "11111111-1111-1111-1111-111111111111",
    );
    assert.equal(
      resolveMcpSealEnvironment("testnet", undefined, null),
      "7d0af0ba-2ae3-4d0e-bc75-0bbaccb3dd71",
    );
  });
});
