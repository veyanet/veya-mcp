/**
 * Smoke: start in-process app, MCP initialize + tools/list + veya_ping_chain + veya_describe.
 */
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createHttpApp } from "../src/http.js";

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
  // Streamable HTTP may return SSE or JSON
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

async function main() {
  const cfg = loadConfig();
  const app = createHttpApp(cfg);
  const server = app.listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;

  try {
    const init = await mcpPost(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "veya-smoke", version: "1.0.0" },
      },
    });
    assert.equal(init.status, 200, `initialize HTTP ${init.status}: ${init.raw.slice(0, 400)}`);
    assert.ok(init.json?.result || init.json?.id === 1, `initialize body: ${init.raw.slice(0, 600)}`);

    const listed = await mcpPost(port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    assert.equal(listed.status, 200, listed.raw.slice(0, 400));
    const tools = listed.json?.result?.tools as Array<{ name: string }> | undefined;
    assert.ok(Array.isArray(tools) && tools.length >= 4, `tools/list: ${listed.raw.slice(0, 800)}`);
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("veya_ping_chain"));
    assert.ok(names.includes("veya_describe"));
    assert.ok(names.includes("veya_verify_transaction"));
    assert.ok(names.includes("veya_hash_blake3"));
    console.log("[smoke] tools", names.join(", "));

    const describe = await mcpPost(port, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "veya_describe", arguments: {} },
    });
    assert.equal(describe.status, 200);
    assert.ok(
      String(describe.raw).includes("46630") || String(describe.json?.result?.content?.[0]?.text).includes("46630"),
      describe.raw.slice(0, 500),
    );
    console.log("[smoke] veya_describe ok");

    const ping = await mcpPost(port, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "veya_ping_chain", arguments: {} },
    });
    assert.equal(ping.status, 200, ping.raw.slice(0, 400));
    const pingText = JSON.stringify(ping.json ?? ping.raw);
    assert.ok(pingText.includes("46630") || pingText.includes("chainId"), pingText.slice(0, 500));
    console.log("[smoke] veya_ping_chain ok");

    console.log("[smoke] PASS");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

main().catch((err) => {
  console.error("[smoke] FAIL", err);
  process.exit(1);
});
