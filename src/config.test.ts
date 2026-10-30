import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ethers } from "ethers";
import {
  loadConfig,
  writesEnabled,
  operatorRelayerWritesEnabled,
  sealDecisionRelayerEnabled,
  MCP_SERVICE_NAME,
  MCP_SERVICE_VERSION,
  MAINNET_PROTOCOL_CONTRACT,
} from "./config.js";
import { createHttpApp } from "./http.js";
import { authHeaders, toolApiResult, toolJson } from "./api.js";
import {
  isProductApiKey,
  requireProductApiKey,
  resolveCredential,
  MINT_API_KEY_HINT,
  NO_TESTNET_TOKENS,
  noFundsMessage,
} from "./credentials.js";
import {
  mapWriteError,
  resolvePayerPrivateKey,
  payerAddress,
  assertPayerMatchesAccount,
  assertPayerFunded,
} from "./payer.js";

describe("veyanet mcp config", () => {
  it("defaults to mainnet 4663 and version 1.2.11", () => {
    const prev = process.env.ROBINHOOD_NETWORK;
    const prevContract = process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
    delete process.env.ROBINHOOD_NETWORK;
    delete process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
    delete process.env.ROBINHOOD_CHAIN_ID;
    try {
      const cfg = loadConfig();
      assert.equal(cfg.network, "mainnet");
      assert.equal(cfg.chainId, 4663);
      assert.equal(cfg.contractAddress, MAINNET_PROTOCOL_CONTRACT);
      assert.equal(MCP_SERVICE_VERSION, "1.2.11");
    } finally {
      if (prev === undefined) delete process.env.ROBINHOOD_NETWORK;
      else process.env.ROBINHOOD_NETWORK = prev;
      if (prevContract === undefined) delete process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
      else process.env.VEYA_MAINNET_CONTRACT_ADDRESS = prevContract;
    }
  });

  it("ROBINHOOD_NETWORK=testnet keeps the previous contract", () => {
    const prev = process.env.ROBINHOOD_NETWORK;
    const prevContract = process.env.VEYA_CONTRACT_ADDRESS;
    process.env.ROBINHOOD_NETWORK = "testnet";
    delete process.env.VEYA_CONTRACT_ADDRESS;
    delete process.env.ROBINHOOD_CHAIN_ID;
    try {
      const cfg = loadConfig();
      assert.equal(cfg.network, "testnet");
      assert.equal(cfg.chainId, 46630);
      assert.match(cfg.contractAddress, /^0x1a1D/i);
      assert.equal(cfg.rpcUrl, "https://rpc.testnet.chain.robinhood.com");
    } finally {
      if (prev === undefined) delete process.env.ROBINHOOD_NETWORK;
      else process.env.ROBINHOOD_NETWORK = prev;
      if (prevContract === undefined) delete process.env.VEYA_CONTRACT_ADDRESS;
      else process.env.VEYA_CONTRACT_ADDRESS = prevContract;
    }
  });

  it("mainnet profile uses chain 4663, the deployed protocol contract, and the mainnet key slot only", () => {
    const prevNetwork = process.env.ROBINHOOD_NETWORK;
    const prevContract = process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
    const prevTestnetKey = process.env.VEYA_RELAYER_PRIVATE_KEY;
    const prevMainnetKey = process.env.VEYA_MAINNET_RELAYER_PRIVATE_KEY;
    process.env.ROBINHOOD_NETWORK = "mainnet";
    delete process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
    process.env.VEYA_RELAYER_PRIVATE_KEY = "0x" + "ab".repeat(32);
    delete process.env.VEYA_MAINNET_RELAYER_PRIVATE_KEY;
    try {
      const cfg = loadConfig();
      assert.equal(cfg.network, "mainnet");
      assert.equal(cfg.chainId, 4663);
      assert.equal(cfg.rpcUrl, "https://rpc.mainnet.chain.robinhood.com");
      assert.equal(cfg.explorerUrl, "https://robinhoodchain.blockscout.com");
      assert.equal(cfg.contractAddress, MAINNET_PROTOCOL_CONTRACT);
      assert.equal(cfg.relayerPrivateKey, null);
    } finally {
      if (prevNetwork === undefined) delete process.env.ROBINHOOD_NETWORK;
      else process.env.ROBINHOOD_NETWORK = prevNetwork;
      if (prevContract === undefined) delete process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
      else process.env.VEYA_MAINNET_CONTRACT_ADDRESS = prevContract;
      if (prevTestnetKey === undefined) delete process.env.VEYA_RELAYER_PRIVATE_KEY;
      else process.env.VEYA_RELAYER_PRIVATE_KEY = prevTestnetKey;
      if (prevMainnetKey === undefined) delete process.env.VEYA_MAINNET_RELAYER_PRIVATE_KEY;
      else process.env.VEYA_MAINNET_RELAYER_PRIVATE_KEY = prevMainnetKey;
    }
  });

  it("an explicit empty mainnet contract stays unpublished", () => {
    const prevNetwork = process.env.ROBINHOOD_NETWORK;
    const prevContract = process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
    process.env.ROBINHOOD_NETWORK = "mainnet";
    process.env.VEYA_MAINNET_CONTRACT_ADDRESS = "";
    try {
      const cfg = loadConfig();
      assert.equal(cfg.contractAddress, "");
    } finally {
      if (prevNetwork === undefined) delete process.env.ROBINHOOD_NETWORK;
      else process.env.ROBINHOOD_NETWORK = prevNetwork;
      if (prevContract === undefined) delete process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
      else process.env.VEYA_MAINNET_CONTRACT_ADDRESS = prevContract;
    }
  });

  it("user-paid writes stay enabled without host relayer keys", () => {
    delete process.env.MCP_API_KEY;
    delete process.env.VEYA_RELAYER_PRIVATE_KEY;
    delete process.env.VEYA_DEPLOYER_PRIVATE_KEY;
    delete process.env.VEYA_SEAL_DECISION_RELAYER;
    const cfg = loadConfig();
    assert.equal(writesEnabled(cfg), true);
    assert.equal(operatorRelayerWritesEnabled(cfg), false);
    assert.equal(sealDecisionRelayerEnabled(cfg), false);
  });

  it("operator relayer stays off even when host keys are present", () => {
    const prevKey = process.env.MCP_API_KEY;
    const prevRelayer = process.env.VEYA_RELAYER_PRIVATE_KEY;
    const prevSwitch = process.env.VEYA_SEAL_DECISION_RELAYER;
    try {
      process.env.MCP_API_KEY = "operator-secret";
      process.env.VEYA_RELAYER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
      delete process.env.VEYA_SEAL_DECISION_RELAYER;
      const cfg = loadConfig();
      assert.equal(operatorRelayerWritesEnabled(cfg), false);
      assert.equal(sealDecisionRelayerEnabled(cfg), false);
      process.env.VEYA_SEAL_DECISION_RELAYER = "1";
      const enabled = loadConfig();
      assert.equal(operatorRelayerWritesEnabled(enabled), false);
      assert.equal(sealDecisionRelayerEnabled(enabled), true);
    } finally {
      if (prevKey === undefined) delete process.env.MCP_API_KEY;
      else process.env.MCP_API_KEY = prevKey;
      if (prevRelayer === undefined) delete process.env.VEYA_RELAYER_PRIVATE_KEY;
      else process.env.VEYA_RELAYER_PRIVATE_KEY = prevRelayer;
      if (prevSwitch === undefined) delete process.env.VEYA_SEAL_DECISION_RELAYER;
      else process.env.VEYA_SEAL_DECISION_RELAYER = prevSwitch;
    }
  });
});

describe("product API key detection", () => {
  it("accepts veya_ and legacy vya_ prefixes", () => {
    assert.equal(isProductApiKey("veya_dev_abc"), true);
    assert.equal(isProductApiKey("veya_live_abc"), true);
    assert.equal(isProductApiKey("vya_dev_abc"), true);
    assert.equal(isProductApiKey("not-a-key"), false);
    assert.equal(isProductApiKey("eyJhbGciOi"), false);
  });

  it("requireProductApiKey rejects guest JWT", () => {
    assert.throws(() => requireProductApiKey("eyJhbGciOi.guest.jwt-token"), (err: Error) => {
      assert.equal(err.message, MINT_API_KEY_HINT);
      return true;
    });
    assert.throws(() => requireProductApiKey(undefined), /apiKey required/);
  });

  it("resolveCredential prefers apiKey", () => {
    assert.equal(resolveCredential("veya_dev_a", "jwt"), "veya_dev_a");
    assert.equal(resolveCredential(undefined, "guest-session-token"), "guest-session-token");
  });
});

describe("toolApiResult", () => {
  it("marks HTTP 4xx as isError and 2xx as success", () => {
    const fail = toolApiResult({ httpStatus: 403, body: { error: "forbidden" } });
    assert.equal("isError" in fail && fail.isError, true);
    const ok = toolApiResult({ httpStatus: 200, body: { ok: true } });
    assert.equal("isError" in ok, false);
  });

  it("serializes BigInt and bytes so on-chain rows do not crash JSON.stringify", () => {
    const payload = toolJson({
      createdAt: 1789647705n,
      raw: Uint8Array.from([1, 2, 255]),
    });
    const text = payload.content[0].text;
    assert.match(text, /1789647705/);
    assert.match(text, /0x0102ff/);
    assert.doesNotThrow(() => JSON.parse(text));
  });
});

describe("auth headers", () => {
  it("sends X-Api-Key for product keys and Bearer for JWTs", () => {
    const keyHeaders = authHeaders("veya_dev_111_secret");
    assert.equal(keyHeaders["X-Api-Key"], "veya_dev_111_secret");
    assert.equal(keyHeaders.Authorization, "Bearer veya_dev_111_secret");

    const jwtHeaders = authHeaders("eyJhbGciOi.jwt.payload");
    assert.equal(jwtHeaders["X-Api-Key"], undefined);
    assert.equal(jwtHeaders.Authorization, "Bearer eyJhbGciOi.jwt.payload");
  });
});

describe("payer helpers", () => {
  it("maps insufficient funds variants to the exact tokens sentence", () => {
    assert.equal(mapWriteError(new Error("insufficient funds for gas")).message, NO_TESTNET_TOKENS);
    assert.equal(mapWriteError(new Error("INSUFFICIENT_FUNDS")).message, NO_TESTNET_TOKENS);
    assert.equal(mapWriteError(new Error("exceeds the balance of the account")).message, NO_TESTNET_TOKENS);
    assert.equal(mapWriteError(new Error("intrinsic gas too low")).message, NO_TESTNET_TOKENS);
    assert.equal(mapWriteError(new Error("execution reverted: code=-32000")).message, "execution reverted: code=-32000");
    assert.equal(mapWriteError(new Error("other")).message, "other");
    assert.equal(mapWriteError(new Error("UNFUNDED_PAYER")).message, NO_TESTNET_TOKENS);
    assert.equal(
      mapWriteError({ code: "INSUFFICIENT_FUNDS", shortMessage: "insufficient funds for gas" }).message,
      NO_TESTNET_TOKENS,
    );
  });

  it("resolves payer from arg or env and rejects missing", () => {
    const wallet = ethers.Wallet.createRandom();
    const cfg = loadConfig();
    cfg.payerPrivateKey = null;
    assert.equal(resolvePayerPrivateKey(cfg, wallet.privateKey), wallet.privateKey);
    assert.equal(payerAddress(wallet.privateKey).toLowerCase(), wallet.address.toLowerCase());
    assert.throws(() => resolvePayerPrivateKey(cfg, undefined), /payerPrivateKey required/);
    assert.throws(() => resolvePayerPrivateKey(cfg, "not-a-key"), /0x-prefixed/);
  });

  it("refuses a payer that does not match the API key wallet", () => {
    const a = ethers.Wallet.createRandom();
    const b = ethers.Wallet.createRandom();
    assert.throws(
      () => assertPayerMatchesAccount(a.address, b.address),
      /does not match the wallet/,
    );
    assertPayerMatchesAccount(a.address, a.address);
  });
});

describe("veyanet mcp http", () => {
  it("GET /health returns honesty fields including user-paid writes", async () => {
    const prev = process.env.ROBINHOOD_NETWORK;
    const prevContract = process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
    delete process.env.ROBINHOOD_NETWORK;
    delete process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
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
      assert.equal(body.version, "1.2.11");
      assert.equal("chainId" in body, false);
      assert.equal(body.writesEnabled, true);
      assert.equal(body.operatorRelayerWrites, false);
      assert.match(String(body.sealed), /AES-256-GCM/);
      assert.equal(body.network, "mainnet");
    } finally {
      if (prev === undefined) delete process.env.ROBINHOOD_NETWORK;
      else process.env.ROBINHOOD_NETWORK = prev;
      if (prevContract === undefined) delete process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
      else process.env.VEYA_MAINNET_CONTRACT_ADDRESS = prevContract;
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("GET /mcp opens the event stream instead of 404", async () => {
    const cfg = loadConfig();
    const app = createHttpApp(cfg);
    const server = app.listen(0);
    const ac = new AbortController();
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr === "object");
      const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
        headers: { Accept: "text/event-stream" },
        signal: ac.signal,
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    } finally {
      ac.abort();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("GET / always advertises public paste URL and user-paid writes", async () => {
    const cfg = loadConfig();
    cfg.publicMcpUrl = "http://127.0.0.1:9999/mcp";
    const app = createHttpApp(cfg);
    const server = app.listen(0);
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr === "object");
      const res = await fetch(`http://127.0.0.1:${addr.port}/`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /https:\/\/mcp\.veyanet\.tech\/mcp/);
      assert.match(html, /VEYA/);
      assert.match(html, /your<\/em> wallet/i);
      assert.ok(!html.includes("http://127.0.0.1:9999/mcp"));
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

async function mcpPost(port: number, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (text.startsWith("event:") || text.includes("data:")) {
    const dataLines = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    const last = dataLines[dataLines.length - 1];
    return { status: res.status, json: last ? JSON.parse(last) : null, raw: text };
  }
  try {
    return { status: res.status, json: JSON.parse(text), raw: text };
  } catch {
    return { status: res.status, json: null, raw: text };
  }
}

function toolText(json: unknown): string {
  const c = (json as { result?: { content?: Array<{ text?: string }> } })?.result?.content?.[0]?.text;
  return typeof c === "string" ? c : JSON.stringify(json ?? {});
}

describe("product and write tools", () => {
  it("lists write tools without host MCP_API_KEY and refuses missing apiKey", async () => {
    delete process.env.MCP_API_KEY;
    delete process.env.VEYA_RELAYER_PRIVATE_KEY;
    const cfg = loadConfig();
    const app = createHttpApp(cfg);
    const server = app.listen(0);
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr === "object");
      const port = addr.port;

      await mcpPost(port, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "unit", version: "1.2.11" },
        },
      });

      const listed = await mcpPost(port, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const names = ((listed.json?.result?.tools as Array<{ name: string }>) ?? []).map((t) => t.name);
      assert.ok(names.includes("veya_store_commitment"));
      assert.ok(names.includes("veya_writes_status"));
      assert.ok(names.includes("veya_account"));

      const status = await mcpPost(port, {
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: { name: "veya_writes_status", arguments: {} },
      });
      const statusText = toolText(status.json);
      assert.match(statusText, new RegExp(noFundsMessage(cfg.network).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      if (cfg.network === "testnet") {
        assert.match(statusText, /faucet\.testnet\.chain\.robinhood\.com/);
      }
      assert.notEqual((status.json as { result?: { isError?: boolean } })?.result?.isError, true);

      const missing = await mcpPost(port, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "veya_list_environments", arguments: {} },
      });
      const missingText = toolText(missing.json);
      assert.match(missingText, /apiKey required/);
      assert.equal((missing.json as { result?: { isError?: boolean } })?.result?.isError, true);

      const scopedTools = [
        "veya_store_memory",
        "veya_read_memory",
        "veya_invalidate_memory",
        "veya_set_tool_policy",
        "veya_route_message",
        "veya_run_consensus",
        "veya_client_run_consensus",
        "veya_sealed_execute",
        "veya_seal_decision",
      ];
      for (const [index, name] of scopedTools.entries()) {
        const refused = await mcpPost(port, {
          jsonrpc: "2.0",
          id: 30 + index,
          method: "tools/call",
          params: { name, arguments: { environmentId: "env", agentId: "agent", id: "mem", data: "secret", tool: "veya_describe", allowed: true, fromAgent: "a", toAgent: "b", payload: {}, taskId: "t", eventType: "run", sessionEntropyHex: "ab".repeat(16), evidenceId: "e1", decision: "{\"ok\":true}" } },
        });
        assert.match(toolText(refused.json), /apiKey required/);
        assert.equal((refused.json as { result?: { isError?: boolean } })?.result?.isError, true);
      }
      const guestMemory = await mcpPost(port, {
        jsonrpc: "2.0",
        id: 36,
        method: "tools/call",
        params: { name: "veya_store_memory", arguments: { apiKey: "eyJhbGciOi.guest-session-token", environmentId: "env", agentId: "agent", data: "secret" } },
      });
      const proveAnchor = await mcpPost(port, {
        jsonrpc: "2.0",
        id: 37,
        method: "tools/call",
        params: { name: "veya_prove", arguments: { text: "hello", anchor: true, payerPrivateKey: "0x" + "11".repeat(32) } },
      });
      assert.match(toolText(proveAnchor.json), /apiKey required/);

      assert.match(toolText(guestMemory.json), /Create a product API key/);
      assert.equal((guestMemory.json as { result?: { isError?: boolean } })?.result?.isError, true);

      const guestWrite = await mcpPost(port, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "veya_create_environment",
          arguments: { apiKey: "eyJhbGciOi.guest-session-token", name: "nope", type: "research" },
        },
      });
      assert.match(toolText(guestWrite.json), /Create a product API key/);
      assert.equal((guestWrite.json as { result?: { isError?: boolean } })?.result?.isError, true);

      const emptyPayer = ethers.Wallet.createRandom();
      const noPayer = await mcpPost(port, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "veya_store_commitment",
          arguments: {
            apiKey: "veya_dev_00000000-0000-0000-0000-000000000000_notreal",
            environmentUuidHex: "0".repeat(32),
            commitmentHex: "a".repeat(64),
          },
        },
      });
      const noPayerText = toolText(noPayer.json);
      assert.match(noPayerText, /payerPrivateKey required|Product API rejected|Invalid API key|apiKey/);

      const unfunded = await mcpPost(port, {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "veya_store_commitment",
          arguments: {
            apiKey: "veya_dev_00000000-0000-0000-0000-000000000000_notreal",
            payerPrivateKey: emptyPayer.privateKey,
            environmentUuidHex: "0".repeat(32),
            commitmentHex: "a".repeat(64),
          },
        },
      });
      const unfundedText = toolText(unfunded.json);
      assert.match(
        unfundedText,
        /You don't have testnet tokens|Product API rejected|Invalid API key|apiKey/,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("assertPayerFunded rejects a zero-balance wallet on live RPC", async () => {
    const cfg = loadConfig();
    const empty = ethers.Wallet.createRandom();
    await assert.rejects(() => assertPayerFunded(cfg, empty.privateKey), (err: Error) => {
      assert.equal(err.message, noFundsMessage(cfg.network));
      return true;
    });
  });
});
