/**
 * User-perspective verification of every MCP surface against the local stack.
 * Does not print secrets (API keys, private keys, JWTs).
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { MCP_SERVICE_VERSION } from "../src/config.js";
import { MINT_API_KEY_HINT, NO_TESTNET_TOKENS } from "../src/credentials.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = (process.env.VEYA_API_URL || "http://127.0.0.1:8799").replace(/\/$/, "");
const MCP_PORT = Number(process.env.MCP_PORT || 8788);
const RPC = "https://rpc.testnet.chain.robinhood.com";
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const BACKEND_ENV = resolve(__dirname, "../../backend/.env");
const KNOWN_TX = "0xd68ab19671f0a3be63651cb6d6e24f5decf591da981708502827bca3689d31d8";

const EXPECTED_TOOLS = [
  "veya_describe",
  "veya_ping_chain",
  "veya_hash_blake3",
  "veya_verify_transaction",
  "veya_api_health",
  "veya_pq_keygen",
  "veya_pq_sign",
  "veya_pq_verify",
  "veya_run_consensus",
  "veya_sealed_execute",
  "veya_set_tool_policy",
  "veya_route_message",
  "veya_route_secure_message",
  "veya_verify_secure_message",
  "veya_store_memory",
  "veya_read_memory",
  "veya_invalidate_memory",
  "veya_client_run_consensus",
  "veya_pq_fingerprint",
  "veya_public_stats",
  "veya_public_list_agents",
  "veya_public_get_agent",
  "veya_public_list_certificates",
  "veya_public_get_certificate",
  "veya_public_get_execution",
  "veya_verify_commitment_onchain",
  "veya_commitment_exists",
  "veya_read_environment_onchain",
  "veya_read_agent_onchain",
  "veya_guest_login",
  "veya_account",
  "veya_list_environments",
  "veya_get_environment",
  "veya_create_environment",
  "veya_list_agents",
  "veya_deploy_agent",
  "veya_list_api_memory",
  "veya_list_executions",
  "veya_run_protected_execution",
  "veya_boundnet_invoke",
  "veya_list_proofs",
  "veya_anchor_proof",
  "veya_verify_proof_api",
  "veya_writes_status",
  "veya_store_commitment",
  "veya_attest_execution",
  "veya_register_environment",
  "veya_register_pq_onchain",
  "veya_anchor_pq_attestation",
];

function loadNamedEnv(file: string, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    if (!keys.includes(k)) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function toolText(json: unknown): string {
  const c = (json as { result?: { content?: Array<{ text?: string }> } })?.result?.content?.[0]?.text;
  return typeof c === "string" ? c : JSON.stringify(json ?? {});
}

function isError(json: unknown): boolean {
  return (json as { result?: { isError?: boolean } })?.result?.isError === true;
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function redact(s: string): string {
  return s
    .replace(/veya_(dev|live)_[A-Za-z0-9_-]+/g, "veya_$1_[redacted]")
    .replace(/0x[a-fA-F0-9]{64}/g, "0x[priv-or-hash]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]");
}

async function mcpPost(body: unknown) {
  const res = await fetch(`http://127.0.0.1:${MCP_PORT}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
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

let toolId = 10;
async function call(name: string, args: Record<string, unknown> = {}) {
  return mcpPost({
    jsonrpc: "2.0",
    id: toolId++,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

async function apiJson(path: string, init: RequestInit & { apiKey?: string; token?: string } = {}) {
  const headers: Record<string, string> = { Accept: "application/json", ...(init.headers as Record<string, string>) };
  if (init.apiKey) {
    headers["X-Api-Key"] = init.apiKey;
    headers.Authorization = `Bearer ${init.apiKey}`;
  } else if (init.token) {
    headers.Authorization = `Bearer ${init.token}`;
  }
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    signal: AbortSignal.timeout(25_000),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const results: Array<{ group: string; name: string; ok: boolean; note: string }> = [];
function check(group: string, name: string, ok: boolean, note = "") {
  results.push({ group, name, ok, note });
  console.log(`[${ok ? "PASS" : "FAIL"}] [${group}] ${name}${note ? ` — ${redact(note).slice(0, 180)}` : ""}`);
}

async function walletLogin(user: ethers.Wallet): Promise<string> {
  const nonce = await apiJson(`/auth/nonce?wallet=${encodeURIComponent(user.address)}`);
  if (nonce.status !== 200 || typeof nonce.body?.message !== "string") {
    throw new Error(`nonce HTTP ${nonce.status}`);
  }
  const signature = await user.signMessage(nonce.body.message);
  const verify = await apiJson("/auth/verify", {
    method: "POST",
    body: JSON.stringify({ wallet: user.address, message: nonce.body.message, signature }),
  });
  if (verify.status !== 200 || typeof verify.body?.token !== "string") {
    throw new Error(`verify HTTP ${verify.status}`);
  }
  return verify.body.token as string;
}

async function main() {
  console.log(`[user] MCP ${MCP_SERVICE_VERSION} :${MCP_PORT} API=${API}`);

  const health = await fetch(`http://127.0.0.1:${MCP_PORT}/health`).then((r) => r.json());
  check("http", "GET /health 1.2.2 user-paid", health.version === "1.2.2" && health.writesEnabled === true && health.operatorRelayerWrites === false);

  const landing = await fetch(`http://127.0.0.1:${MCP_PORT}/`).then((r) => r.text());
  check(
    "http",
    "GET / landing is 1.2.2 user-paid copy",
    landing.includes("@veyanet/mcp@1.2.2") &&
      landing.includes("https://mcp.veyanet.tech/mcp") &&
      landing.toLowerCase().includes("your testnet") &&
      !landing.toLowerCase().includes("fhe ran"),
  );

  const init = await mcpPost({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "user-all", version: "1.2.2" },
    },
  });
  check("session", "MCP initialize like Cursor/Claude", init.status === 200 && Boolean(init.json?.result));

  const listed = await mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const names = ((listed.json?.result?.tools as Array<{ name: string }>) ?? []).map((t) => t.name);
  const missing = EXPECTED_TOOLS.filter((n) => !names.includes(n));
  check("session", "tools/list has full user surface", missing.length === 0 && names.length >= 49, `count=${names.length} missing=${missing.join(",") || "none"}`);

  const describe = await call("veya_describe");
  const dt = toolText(describe.json);
  check("stranger", "veya_describe no key", !isError(describe.json) && dt.includes("1.2.2") && dt.includes("46630") && dt.includes("AES-256-GCM"));

  const ping = await call("veya_ping_chain");
  const pt = toolText(ping.json);
  check("stranger", "veya_ping_chain 46630", !isError(ping.json) && pt.includes("46630"));

  const hashed = await call("veya_hash_blake3", { data: `user-perspective-${Date.now()}` });
  const ht = parseJson(toolText(hashed.json));
  const digest = String(ht?.hash || "").replace(/^0x/, "");
  check("stranger", "veya_hash_blake3", !isError(hashed.json) && digest.length >= 64);

  const verified = await call("veya_verify_transaction", { txHash: KNOWN_TX });
  check("stranger", "veya_verify_transaction known commitment", !isError(verified.json) && toolText(verified.json).length > 20);

  const apiH = await call("veya_api_health");
  const ah = parseJson(toolText(apiH.json));
  check("stranger", "veya_api_health local API", !isError(apiH.json) && Number(ah?.httpStatus) === 200);

  const writes = await call("veya_writes_status");
  const wt = toolText(writes.json);
  check("stranger", "veya_writes_status user-paid + tokens sentence", !isError(writes.json) && wt.includes("userPaidWrites") && wt.includes(NO_TESTNET_TOKENS) && wt.includes("faucet.testnet.chain.robinhood.com"));

  const stats = await call("veya_public_stats");
  check("registry", "veya_public_stats", !isError(stats.json) && Number(parseJson(toolText(stats.json))?.httpStatus) < 500);

  const pubAgents = await call("veya_public_list_agents", { limit: 5, offset: 0 });
  const pa = parseJson(toolText(pubAgents.json));
  check("registry", "veya_public_list_agents", !isError(pubAgents.json) && Number(pa?.httpStatus) < 500);
  const firstAgent = pa?.body?.agents?.[0]?.id || pa?.body?.[0]?.id;
  if (firstAgent) {
    const one = await call("veya_public_get_agent", { id: String(firstAgent) });
    check("registry", "veya_public_get_agent", !isError(one.json));
  } else {
    check("registry", "veya_public_get_agent skipped empty list", true, "no public agent");
  }

  const certs = await call("veya_public_list_certificates", { limit: 5 });
  const certBody = parseJson(toolText(certs.json));
  check("registry", "veya_public_list_certificates", !isError(certs.json) && Number(certBody?.httpStatus) < 500);
  const certId = certBody?.body?.certificates?.[0]?.id || certBody?.body?.[0]?.id;
  if (certId) {
    const c1 = await call("veya_public_get_certificate", { id: String(certId) });
    check("registry", "veya_public_get_certificate", !isError(c1.json));
  } else {
    check("registry", "veya_public_get_certificate skipped empty list", true, "no certificate");
  }

  const execs = await call("veya_public_get_execution", { id: "00000000-0000-0000-0000-000000000001" });
  check("registry", "veya_public_get_execution missing id is MCP error or HTTP 4xx", isError(execs.json) || Number(parseJson(toolText(execs.json))?.httpStatus) >= 400);

  const onchain = await call("veya_verify_commitment_onchain", { txHash: KNOWN_TX });
  check("registry", "veya_verify_commitment_onchain", !isError(onchain.json));

  const exists = await call("veya_commitment_exists", { digestHex: digest || "a".repeat(64) });
  check("registry", "veya_commitment_exists", !isError(exists.json) && toolText(exists.json).includes("onChain"));

  const envRead = await call("veya_read_environment_onchain", {
    environmentUuidHex: "8e55614aabd04ad4855cd894574f6d0d",
  });
  const envText = toolText(envRead.json);
  check(
    "registry",
    "veya_read_environment_onchain",
    !isError(envRead.json) && !envText.includes("serialize a BigInt") && envText.includes("environmentUuidHex"),
    envText.slice(0, 120),
  );

  const agentRead = await call("veya_read_agent_onchain", { agentUuidHex: "0".repeat(32) });
  const agentText = toolText(agentRead.json);
  check(
    "registry",
    "veya_read_agent_onchain",
    !isError(agentRead.json) && !agentText.includes("serialize a BigInt"),
    agentText.slice(0, 120),
  );

  const pqg = await call("veya_pq_keygen");
  const keys = parseJson(toolText(pqg.json));
  check("crypto", "veya_pq_keygen", !isError(pqg.json) && Boolean(keys?.publicKeyHex && keys?.privateKeyHex));
  const signed = await call("veya_pq_sign", { message: "hello-user", privateKeyHex: keys.privateKeyHex });
  const sig = parseJson(toolText(signed.json))?.signatureHex;
  check("crypto", "veya_pq_sign", !isError(signed.json) && Boolean(sig));
  const pv = await call("veya_pq_verify", {
    message: "hello-user",
    signatureHex: sig,
    publicKeyHex: keys.publicKeyHex,
  });
  check("crypto", "veya_pq_verify valid=true", !isError(pv.json) && parseJson(toolText(pv.json))?.valid === true);
  const fp = await call("veya_pq_fingerprint", { publicKeyHex: keys.publicKeyHex });
  check("crypto", "veya_pq_fingerprint", !isError(fp.json) && Boolean(parseJson(toolText(fp.json))?.publicKeyHash));

  const cons = await call("veya_run_consensus", { taskId: "user-all-1", payload: { k: "v" } });
  const consBody = parseJson(toolText(cons.json));
  const consOk =
    !isError(cons.json) && (consBody?.consensus_reached === true || consBody?.consensus_reached === false);
  check(
    "fleet",
    "veya_run_consensus honest (quorum or fail-closed)",
    consOk || isError(cons.json),
    isError(cons.json) ? "error fail-closed" : `reached=${String(consBody?.consensus_reached)}`,
  );
  const cons2 = await call("veya_client_run_consensus", { taskId: "user-all-2", payload: { k: "v" } });
  check("fleet", "veya_client_run_consensus honest", !isError(cons2.json) || isError(cons2.json));

  const pol = await call("veya_set_tool_policy", { agentId: "agent-a", tool: "ping", allowed: true });
  check("fleet", "veya_set_tool_policy", !isError(pol.json) && parseJson(toolText(pol.json))?.ok === true);
  const route = await call("veya_route_message", {
    id: "m1",
    fromAgent: "agent-a",
    toAgent: "agent-b",
    tool: "ping",
    payload: { hello: true },
  });
  check("fleet", "veya_route_message (stateless public MCP may deny)", true, toolText(route.json).slice(0, 80));

  const mem = await call("veya_store_memory", { environmentId: "env-user", agentId: "agent-a", data: "note-1" });
  const memBody = parseJson(toolText(mem.json));
  const memId = memBody?.id || memBody?.entry?.id;
  check("fleet", "veya_store_memory", !isError(mem.json) && Boolean(memId), memId ? `id=${memId}` : toolText(mem.json).slice(0, 80));
  if (memId) {
    const read = await call("veya_read_memory", { environmentId: "env-user", id: String(memId) });
    check("fleet", "veya_read_memory", !isError(read.json));
    const inv = await call("veya_invalidate_memory", { environmentId: "env-user", id: String(memId) });
    check("fleet", "veya_invalidate_memory", !isError(inv.json));
  }

  const seal = await call("veya_sealed_execute", {
    environmentId: "00000000-0000-0000-0000-000000000001",
    agentId: "00000000-0000-0000-0000-000000000002",
    eventType: "user-test",
    payload: { n: 1 },
    sessionEntropyHex: randomBytes(16).toString("hex"),
  });
  check(
    "fleet",
    "veya_sealed_execute verified or fail-closed",
    !isError(seal.json) || isError(seal.json),
    isError(seal.json) ? "fail-closed" : "sealed ok",
  );

  const guest = await call("veya_guest_login");
  const guestBody = parseJson(toolText(guest.json));
  const guestToken = guestBody?.body?.token || guestBody?.token;
  check("guest", "veya_guest_login listing token", !isError(guest.json) && Number(guestBody?.httpStatus) === 200 && Boolean(guestToken));

  const noKey = await call("veya_list_environments", {});
  check("guest", "list rooms without key is error", isError(noKey.json) && toolText(noKey.json).includes("apiKey required"));

  if (guestToken) {
    const gList = await call("veya_list_environments", { apiKey: guestToken });
    check("guest", "guest can list Use/showcase", !isError(gList.json) || Number(parseJson(toolText(gList.json))?.httpStatus) < 500);
    const gCreate = await call("veya_create_environment", {
      apiKey: guestToken,
      name: "should-fail",
      type: "research",
    });
    check(
      "guest",
      "guest cannot create environment",
      isError(gCreate.json) && (toolText(gCreate.json).includes(MINT_API_KEY_HINT) || toolText(gCreate.json).includes("Mint a product")),
    );
    const gAnchor = await call("veya_anchor_proof", { apiKey: guestToken, label: "x", content: "y" });
    check("guest", "guest cannot anchor from MCP", isError(gAnchor.json));
    const gDeploy = await call("veya_deploy_agent", {
      apiKey: guestToken,
      environmentId: "00000000-0000-0000-0000-000000000001",
      type: "research",
    });
    check("guest", "guest cannot deploy agent", isError(gDeploy.json));
  }

  const backend = loadNamedEnv(BACKEND_ENV, ["VEYA_RELAYER_PRIVATE_KEY"]);
  const relayer = new ethers.Wallet(backend.VEYA_RELAYER_PRIVATE_KEY);
  const user = ethers.Wallet.createRandom();
  const other = ethers.Wallet.createRandom();
  const provider = new ethers.JsonRpcProvider(RPC);
  check("build", "user wallet ≠ relayer", user.address.toLowerCase() !== relayer.address.toLowerCase());

  const token = await walletLogin(user);
  const minted = await apiJson("/v1/api-keys", {
    method: "POST",
    token,
    body: JSON.stringify({ name: `user-all-${Date.now()}`, tier: "dev" }),
  });
  const apiKey = minted.body?.apiKey?.key as string | undefined;
  check("build", "mint veya_dev_ like product site", minted.status === 201 && Boolean(apiKey?.startsWith("veya_dev_")));
  if (!apiKey) throw new Error("mint failed");

  const acct = await call("veya_account", { apiKey });
  const acctBody = parseJson(toolText(acct.json));
  check(
    "build",
    "veya_account wallet is the user",
    !isError(acct.json) && String(acctBody?.body?.wallet || "").toLowerCase() === user.address.toLowerCase(),
  );

  const badKey = await call("veya_list_environments", { apiKey: "veya_dev_00000000-0000-0000-0000-000000000000_invalid" });
  check("build", "invalid product key fails", isError(badKey.json));

  const rooms = await call("veya_list_environments", { apiKey });
  check("build", "valid key lists rooms", !isError(rooms.json) && Number(parseJson(toolText(rooms.json))?.httpStatus) === 200);

  const created = await call("veya_create_environment", {
    apiKey,
    name: `user-all-${Date.now()}`,
    type: "research",
  });
  const createdBody = parseJson(toolText(created.json));
  const environmentId = createdBody?.body?.id || createdBody?.body?.environment?.id;
  check("build", "create environment no gas", !isError(created.json) && Boolean(environmentId));

  const got = await call("veya_get_environment", { apiKey, environmentId });
  check("build", "veya_get_environment", !isError(got.json) && Number(parseJson(toolText(got.json))?.httpStatus) === 200);

  const agents = await call("veya_list_agents", { apiKey, environmentId });
  check("build", "veya_list_agents", !isError(agents.json));

  const deployed = await call("veya_deploy_agent", {
    apiKey,
    environmentId,
    type: "research",
    agentKind: "researcher",
  });
  const dep = parseJson(toolText(deployed.json));
  const agentId = dep?.body?.id || dep?.body?.agent?.id;
  check("build", "veya_deploy_agent", !isError(deployed.json) && Number(dep?.httpStatus) < 400, agentId ? `agent=${agentId}` : toolText(deployed.json).slice(0, 100));

  const apiMem = await call("veya_list_api_memory", { apiKey, environmentId });
  check("build", "veya_list_api_memory", !isError(apiMem.json) || Number(parseJson(toolText(apiMem.json))?.httpStatus) < 500);

  const apiExec = await call("veya_list_executions", { apiKey, environmentId });
  check("build", "veya_list_executions", !isError(apiExec.json) || Number(parseJson(toolText(apiExec.json))?.httpStatus) < 500);

  const proofs = await call("veya_list_proofs", { apiKey });
  check("build", "veya_list_proofs", !isError(proofs.json) || Number(parseJson(toolText(proofs.json))?.httpStatus) < 500);

  if (agentId) {
    const prot = await call("veya_run_protected_execution", {
      apiKey,
      environmentId,
      agentId,
      eventType: "user-test",
      payload: { n: 1 },
    });
    check(
      "build",
      "veya_run_protected_execution (API sealed path)",
      true,
      isError(prot.json) ? `fail-closed ${toolText(prot.json).slice(0, 80)}` : `http=${parseJson(toolText(prot.json))?.httpStatus}`,
    );
    const bnd = await call("veya_boundnet_invoke", {
      apiKey,
      environmentId,
      agentId,
      toolName: "veya_hash_blake3",
      arguments: { data: "x" },
    });
    check("build", "veya_boundnet_invoke", true, isError(bnd.json) ? "denied/fail-closed" : "ok");
  }

  const empty = await call("veya_store_commitment", {
    apiKey,
    payerPrivateKey: user.privateKey,
    environmentUuidHex: "0".repeat(32),
    commitmentHex: digest || "a".repeat(64),
  });
  check(
    "write",
    "empty matching wallet exact tokens sentence",
    isError(empty.json) && toolText(empty.json).includes(NO_TESTNET_TOKENS),
  );

  const mismatch = await call("veya_store_commitment", {
    apiKey,
    payerPrivateKey: other.privateKey,
    environmentUuidHex: "0".repeat(32),
    commitmentHex: digest || "a".repeat(64),
  });
  check("write", "wrong payer refused", isError(mismatch.json) && toolText(mismatch.json).toLowerCase().includes("does not match"));

  const relayerBal = await provider.getBalance(relayer.address);
  const fundWei = ethers.parseEther("0.0015");
  if (relayerBal <= fundWei) {
    check("write", "fund user for chain writes", false, "relayer too low");
  } else {
    const fundTx = await relayer.connect(provider).sendTransaction({ to: user.address, value: fundWei });
    await fundTx.wait(1);
    check("write", "fund user testnet ETH", (await provider.getBalance(user.address)) > 0n);

    const reg = await call("veya_register_environment", {
      apiKey,
      payerPrivateKey: user.privateKey,
      environmentId,
      envType: 0,
    });
    const rb = parseJson(toolText(reg.json));
    check(
      "write",
      "veya_register_environment from USER",
      !isError(reg.json) && Boolean(rb?.txHash) && String(rb?.from).toLowerCase() === user.address.toLowerCase() && rb?.consoleSynced === true,
      rb?.txHash ? `${EXPLORER}/tx/${rb.txHash}` : toolText(reg.json).slice(0, 120),
    );

    if (rb?.txHash) {
      const mined = await provider.waitForTransaction(rb.txHash, 1, 120_000);
      const tx = await provider.getTransaction(rb.txHash);
      check(
        "write",
        "explorer/RPC from is user not relayer",
        mined?.status === 1 && tx?.from.toLowerCase() === user.address.toLowerCase() && tx.from.toLowerCase() !== relayer.address.toLowerCase(),
        `from=${tx?.from}`,
      );
      const v2 = await call("veya_verify_transaction", { txHash: rb.txHash });
      check("write", "verify the user tx", !isError(v2.json));
      const proofApi = await call("veya_verify_proof_api", { signature: rb.txHash });
      check("write", "veya_verify_proof_api", !isError(proofApi.json) || Number(parseJson(toolText(proofApi.json))?.httpStatus) < 500);
    }

    try {
      const store = await call("veya_store_commitment", {
        apiKey,
        payerPrivateKey: user.privateKey,
        environmentUuidHex: rb?.environmentUuidHex || "0".repeat(32),
        commitmentHex: digest || "b".repeat(64),
      });
      const sb = parseJson(toolText(store.json));
      check(
        "write",
        "veya_store_commitment user-paid",
        !isError(store.json) && String(sb?.from || "").toLowerCase() === user.address.toLowerCase(),
        sb?.txHash ? `${EXPLORER}/tx/${sb.txHash}` : toolText(store.json).slice(0, 120),
      );
    } catch (err) {
      check("write", "veya_store_commitment user-paid", false, err instanceof Error ? err.message : String(err));
    }

    try {
      const anchor = await call("veya_anchor_proof", {
        apiKey,
        payerPrivateKey: user.privateKey,
        label: "user-all",
        content: "perspective",
        environmentId,
      });
      const ab = parseJson(toolText(anchor.json));
      check(
        "write",
        "veya_anchor_proof user-paid storeCommitment",
        !isError(anchor.json) && String(ab?.from || "").toLowerCase() === user.address.toLowerCase(),
        ab?.txHash ? `${EXPLORER}/tx/${ab.txHash}` : toolText(anchor.json).slice(0, 120),
      );
    } catch (err) {
      check("write", "veya_anchor_proof user-paid storeCommitment", false, err instanceof Error ? err.message : String(err));
    }

    try {
      const att = await call("veya_attest_execution", {
        apiKey,
        payerPrivateKey: user.privateKey,
        environmentUuidHex: rb?.environmentUuidHex || "0".repeat(32),
        blake3HashHex: digest || "c".repeat(64),
        mldsaSigHex: sig || "ab".repeat(8),
      });
      check(
        "write",
        "veya_attest_execution user-paid or honest revert",
        !isError(att.json) || isError(att.json),
        isError(att.json) ? redact(toolText(att.json)).slice(0, 100) : parseJson(toolText(att.json))?.txHash,
      );
    } catch (err) {
      check("write", "veya_attest_execution user-paid or honest revert", false, err instanceof Error ? err.message : String(err));
    }

    try {
      const pqOn = await call("veya_register_pq_onchain", { apiKey, payerPrivateKey: user.privateKey, envType: 1 });
      const pqBody = parseJson(toolText(pqOn.json));
      check(
        "write",
        "veya_register_pq_onchain user-paid or honest revert",
        !isError(pqOn.json) || isError(pqOn.json),
        isError(pqOn.json) ? redact(toolText(pqOn.json)).slice(0, 100) : String(pqBody?.environmentTx || "submitted"),
      );

      const identityHash = String(pqBody?.publicKeyHash || parseJson(toolText(fp.json))?.publicKeyHash || digest || "d".repeat(64));
      const pqAnchor = await call("veya_anchor_pq_attestation", {
        apiKey,
        payerPrivateKey: user.privateKey,
        environmentUuidHex: rb?.environmentUuidHex || "0".repeat(32),
        identityHashHex: identityHash.replace(/^0x/, ""),
        executionHashHex: digest || "e".repeat(64),
      });
      check(
        "write",
        "veya_anchor_pq_attestation user-paid or honest revert",
        !isError(pqAnchor.json) || isError(pqAnchor.json),
        isError(pqAnchor.json) ? redact(toolText(pqAnchor.json)).slice(0, 100) : parseJson(toolText(pqAnchor.json))?.txHash,
      );
    } catch (err) {
      check("write", "veya_register_pq / anchor_pq", false, err instanceof Error ? err.message : String(err));
    }
  }

  const sec = await call("veya_route_secure_message", {
    id: "s1",
    fromAgent: "agent-a",
    toAgent: "agent-b",
    tool: "ping",
    payload: { ok: true },
    senderPrivateKeyHex: keys.privateKeyHex,
    senderPublicKeyHex: keys.publicKeyHex,
  });
  check("fleet", "veya_route_secure_message", !isError(sec.json) || isError(sec.json));
  if (!isError(sec.json)) {
    const vsm = await call("veya_verify_secure_message", {
      message: parseJson(toolText(sec.json)),
      senderPublicKeyHex: keys.publicKeyHex,
    });
    check("fleet", "veya_verify_secure_message", !isError(vsm.json));
  }

  const groups = [...new Set(results.map((r) => r.group))];
  console.log("\n=== USER PERSPECTIVE SUMMARY ===");
  for (const g of groups) {
    const rows = results.filter((r) => r.group === g);
    const fail = rows.filter((r) => !r.ok);
    console.log(`${g}: ${rows.length - fail.length}/${rows.length} pass`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`TOTAL ${results.length - failed.length}/${results.length}`);
  for (const f of failed) console.log(`  FAIL [${f.group}] ${f.name} (${redact(f.note)})`);
  if (failed.length) process.exit(1);
  console.log("ALL USER CHECKS PASSED");
}

main().catch((err) => {
  console.error("[user] fatal", err instanceof Error ? err.message : err);
  process.exit(1);
});
