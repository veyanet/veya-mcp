/**
 * Extra live checks against a running MCP (default http://127.0.0.1:8788/mcp)
 */
const BASE = process.env.MCP_BASE || "http://127.0.0.1:8788";
const KNOWN_TX =
  "0xd68ab19671f0a3be63651cb6d6e24f5decf591da981708502827bca3689d31d8";
const KEY = process.env.MCP_API_KEY || "veya-local-dave-verify-key";

async function mcpPost(body: unknown, bearer?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (text.includes("data:")) {
    const last = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .at(-1);
    return { status: res.status, json: last ? JSON.parse(last) : null, raw: text };
  }
  return { status: res.status, json: JSON.parse(text), raw: text };
}

function textOf(json: any) {
  return json?.result?.content?.[0]?.text ?? JSON.stringify(json);
}

async function main() {
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  console.log("[live] /health", {
    version: health.version,
    writesEnabled: health.writesEnabled,
    chainId: health.chainId,
  });

  await mcpPost({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "live-dave", version: "1.1.0" },
    },
  });

  const list = await mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const names = (list.json?.result?.tools ?? []).map((t: any) => t.name);
  console.log("[live] tools", names.length);

  const verify = await mcpPost({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "veya_verify_transaction", arguments: { txHash: KNOWN_TX } },
  });
  console.log("[live] verify known tx:", textOf(verify.json).slice(0, 500));

  const onchain = await mcpPost({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "veya_verify_commitment_onchain",
      arguments: { txHash: KNOWN_TX },
    },
  });
  console.log("[live] verify commitment onchain:", textOf(onchain.json).slice(0, 500));

  const guest = await mcpPost({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "veya_guest_login", arguments: {} },
  });
  const gt = textOf(guest.json);
  const parsed = JSON.parse(gt);
  const token = parsed?.body?.token || parsed?.body?.accessToken;
  console.log("[live] guest login httpStatus", parsed.httpStatus, "token?", Boolean(token));

  if (token) {
    const proofs = await mcpPost({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "veya_list_proofs", arguments: { sessionToken: token } },
    });
    console.log("[live] list proofs:", textOf(proofs.json).slice(0, 300));

    const anchor = await mcpPost({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "veya_anchor_proof",
        arguments: {
          sessionToken: token,
          label: "dave-mcp-verify",
          content: `local mcp verify ${new Date().toISOString()}`,
        },
      },
    });
    console.log("[live] anchor proof:", textOf(anchor.json).slice(0, 400));
  }

  // Dave write auth probe only (no need for successful mint if env missing)
  const denied = await mcpPost(
    {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "veya_register_environment",
        arguments: {
          environmentUuidHex: "646176652d6d63702d76657269667921", // dave-mcp-verify!
          pqPubkeyHashHex: "d".repeat(64),
          envType: 1,
        },
      },
    },
    KEY,
  );
  console.log("[live] dave register_environment:", textOf(denied.json).slice(0, 400));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
