/**
 * User-agent tester.
 * Walks the public product the way a person would, then checks the clone gates.
 * Does not read a relayer key, does not fund a wallet, and does not broadcast.
 * The report redacts API keys, JWTs, and private keys.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet, ethers, type HDNodeWallet } from "ethers";
import * as veyaSdk from "@veyanet/sdk";

const MCP = (process.env.VEYA_MCP_URL || "https://mcp.veyanet.tech/mcp").replace(/\/$/, "");
const API = (process.env.VEYA_API_URL || "https://api.veyanet.tech").replace(/\/$/, "");
const MCP_ORIGIN = MCP.replace(/\/mcp$/, "");

type Status = "pass" | "bug" | "gap" | "blocked";

type Step = {
  id: string;
  lane: string;
  name: string;
  expect: string;
  status: Status;
  detail: string;
  ms: number;
};

const steps: Step[] = [];
let rpcId = 1;

function redact(value: string): string {
  return value
    .replace(/veya_(dev|live)_[A-Za-z0-9_-]+/g, "veya_$1_[redacted]")
    .replace(/0x[a-fA-F0-9]{64}/g, "0x[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/privateKeyHex"\s*:\s*"[^"]+"/g, 'privateKeyHex":"[redacted]"');
}

function clip(value: string, max = 220): string {
  const clean = redact(value).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

async function record(
  id: string,
  lane: string,
  name: string,
  expect: string,
  run: () => Promise<{ status: Status; detail: string }>,
): Promise<Step> {
  const started = Date.now();
  let status: Status = "bug";
  let detail = "";
  try {
    const out = await run();
    status = out.status;
    detail = clip(out.detail);
  } catch (err) {
    status = "bug";
    detail = clip(err instanceof Error ? err.message : String(err));
  }
  const step: Step = { id, lane, name, expect, status, detail, ms: Date.now() - started };
  steps.push(step);
  console.log(`[${status.toUpperCase()}] ${id} ${name} — ${detail}`);
  return step;
}

async function mcpPost(body: unknown, timeoutMs = 25_000) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (text.includes("data:")) {
    const dataLines = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    const last = dataLines[dataLines.length - 1];
    return { status: res.status, json: last ? JSON.parse(last) : null };
  }
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: null as null, raw: text.slice(0, 300) };
  }
}

async function callTool(name: string, args: Record<string, unknown> = {}, timeoutMs = 25_000) {
  const res = await mcpPost(
    { jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args } },
    timeoutMs,
  );
  const text = String(res.json?.result?.content?.[0]?.text ?? "");
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return {
    http: res.status,
    isError: res.json?.result?.isError === true,
    text,
    parsed,
  };
}

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    signal: AbortSignal.timeout(25_000),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body: body as Record<string, any> };
}

function codeOf(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) return String((err as { code: unknown }).code);
  return "";
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SDK_RAW = (process.env.VEYA_SDK_RAW_URL || "https://raw.githubusercontent.com/veyanet/veya-sdk/main").replace(/\/$/, "");

async function apiHealth(): Promise<Record<string, any>> {
  const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(20_000) });
  return (await res.json().catch(() => ({}))) as Record<string, any>;
}
const PROTOCOL = "0x87dC582eEA544A434a5C1e30Ca3d12c1e548a674";

function writeReport(name: string, extra: Record<string, unknown> = {}) {
  const counts = {
    pass: steps.filter((step) => step.status === "pass").length,
    bug: steps.filter((step) => step.status === "bug").length,
    gap: steps.filter((step) => step.status === "gap").length,
    blocked: steps.filter((step) => step.status === "blocked").length,
  };
  const report = {
    ranAt: new Date().toISOString(),
    mcp: MCP_ORIGIN,
    api: API,
    protocolContract: PROTOCOL,
    notAToken: true,
    broadcast: false,
    relayerKeyRead: false,
    publicHost: "mainnet",
    counts,
    steps,
    bugs: steps.filter((step) => step.status === "bug").map((step) => ({
      id: step.id,
      name: step.name,
      expect: step.expect,
      detail: step.detail,
    })),
    ...extra,
  };
  const out = resolve(REPO_ROOT, "reports", name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`[user-agent] ${counts.pass} pass, ${counts.bug} bug, ${counts.gap} gap, ${counts.blocked} blocked`);
  console.log(`[user-agent] report ${out}`);
  if (counts.bug > 0) process.exitCode = 1;
  return counts;
}

async function phase3Audit() {
  console.log("[phase3-tester] local surfaces, read-only chain, public health only");
  console.log("[phase3-tester] no relayer key, no funding, no broadcast, public host not switched");
  const knownHolds: string[] = [];

  await record("pin", "local", "Pinned protocol address", "SDK, API, and MCP name the same contract when the env var is unset", async () => {
    const prev = process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
    const prevNet = process.env.ROBINHOOD_NETWORK;
    delete process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
    process.env.ROBINHOOD_NETWORK = "mainnet";
    try {
      const mcp = await import("../src/config.ts");
      const resolved = veyaSdk.resolveConfig({
        network: "mainnet",
        payerPrivateKey: `0x${"11".repeat(32)}`,
      });
      const mcpCfg = mcp.loadConfig();
      // The API's settlement profile is read from its public /health, not from backend source.
      const health = await apiHealth();
      const apiContract = String(health.robinhood?.contractAddress ?? "");
      const apiNetwork = String(health.robinhood?.network ?? "");
      const same =
        veyaSdk.PHASE3_DECISION.contractAddress === PROTOCOL &&
        veyaSdk.ROBINHOOD_MAINNET.contractAddress === PROTOCOL &&
        resolved.contractAddress === PROTOCOL &&
        apiContract === PROTOCOL &&
        apiNetwork === "mainnet" &&
        mcp.MAINNET_PROTOCOL_CONTRACT === PROTOCOL &&
        mcpCfg.contractAddress === PROTOCOL &&
        mcpCfg.chainId === veyaSdk.ROBINHOOD_MAINNET_CHAIN_ID;
      if (!same) {
        return {
          status: "bug",
          detail: `sdk ${veyaSdk.PHASE3_DECISION.contractAddress} api ${apiContract || "unset"} (${apiNetwork || "no network"}) mcp ${mcpCfg.contractAddress}`,
        };
      }
      return { status: "pass", detail: PROTOCOL };
    } finally {
      if (prev === undefined) delete process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
      else process.env.VEYA_MAINNET_CONTRACT_ADDRESS = prev;
      if (prevNet === undefined) delete process.env.ROBINHOOD_NETWORK;
      else process.env.ROBINHOOD_NETWORK = prevNet;
    }
  });

  await record("empty", "local", "Explicit empty contract", "An empty string stays unpublished and sends nothing", async () => {
    const prev = process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
    const prevNet = process.env.ROBINHOOD_NETWORK;
    process.env.ROBINHOOD_NETWORK = "mainnet";
    process.env.VEYA_MAINNET_CONTRACT_ADDRESS = "";
    try {
      const mcp = await import("../src/config.ts");
      const resolved = veyaSdk.resolveConfig({ network: "mainnet", contractAddress: "" });
      if (resolved.contractAddress !== "" || mcp.loadConfig().contractAddress !== "") {
        return { status: "bug", detail: "an explicit empty contract was replaced with the pin" };
      }
      try {
        new veyaSdk.EvmAnchor({ network: "mainnet", contractAddress: "", payerPrivateKey: `0x${"11".repeat(32)}` });
        return { status: "bug", detail: "empty contract constructed an anchor" };
      } catch (err) {
        if (codeOf(err) !== "MAINNET_UNPUBLISHED") return { status: "bug", detail: `anchor code ${codeOf(err) || "none"}` };
      }
      return { status: "pass", detail: "MAINNET_UNPUBLISHED before a provider" };
    } finally {
      if (prev === undefined) delete process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
      else process.env.VEYA_MAINNET_CONTRACT_ADDRESS = prev;
      if (prevNet === undefined) delete process.env.ROBINHOOD_NETWORK;
      else process.env.ROBINHOOD_NETWORK = prevNet;
    }
  });

  await record("abi", "local", "Protocol ABI is not a token", "No name, symbol, decimals, totalSupply, or transfer", async () => {
    const abi = veyaSdk.VEYA_ABI as unknown as Array<{ type?: string; name?: string }>;
    const names = new Set(abi.filter((item) => item.type === "function").map((item) => item.name));
    const token = ["name", "symbol", "decimals", "totalSupply", "transfer"].filter((name) => names.has(name));
    if (token.length) return { status: "bug", detail: `token surface ${token.join(",")}` };
    if (!names.has("environments") || !names.has("registerEnvironment")) {
      return { status: "bug", detail: "protocol functions missing" };
    }
    return { status: "pass", detail: "environments, agents, commitments, attestations" };
  });

  await record("chain", "local", "On-chain read-back", "Mainnet RPC answers and the protocol contract has code", async () => {
    const rpc = process.env.ROBINHOOD_MAINNET_RPC_URL || veyaSdk.ROBINHOOD_MAINNET.rpcUrl;
    const ping = await veyaSdk.pingRpc(rpc);
    if (Number(ping.chainId) !== veyaSdk.ROBINHOOD_MAINNET_CHAIN_ID) return { status: "bug", detail: "RPC is not on the mainnet profile" };
    const code = await new ethers.JsonRpcProvider(rpc).getCode(PROTOCOL);
    const bytes = (code.length - 2) / 2;
    if (bytes <= 0) return { status: "bug", detail: "no code at the protocol address" };
    return { status: "pass", detail: `block ${ping.blockNumber}, ${bytes} bytes of code` };
  });

  await record("docs", "local", "Docs match the deploy", "Source docs do not say the contract is unpublished", async () => {
    // This repo's files are read locally; the SDK's published docs are fetched from its public repo.
    const files = [
      "veya-sdk/CHANGELOG.md",
      "veya-sdk/docs/DEPLOYMENT.md",
      "veya-mcp/CHANGELOG.md",
      "veya-mcp/README.md",
      "veya-mcp/src/tools/public.ts",
    ];
    const banned = [/not a mainnet deploy/i, /settlement claim \(planned\)/i, /contract stays empty/i];
    const hits: string[] = [];
    for (const file of files) {
      const [repo, ...rest] = file.split("/");
      const rel = rest.join("/");
      let text: string;
      if (repo === "veya-mcp") text = readFileSync(resolve(REPO_ROOT, rel), "utf8");
      else {
        const res = await fetch(`${SDK_RAW}/${rel}`, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) { hits.push(`${file} HTTP ${res.status}`); continue; }
        text = await res.text();
      }
      if (!text.includes(PROTOCOL)) hits.push(`${file} missing address`);
      for (const pattern of banned) {
        if (pattern.test(text)) hits.push(`${file} ${pattern}`);
      }
    }
    if (hits.length) return { status: "bug", detail: hits.join("; ") };
    return { status: "pass", detail: `${files.length} files name the protocol contract` };
  });

  await record("guards", "local", "Spend, guest, receipt, and deploy plan", "Those gates still stop before a send", async () => {
    const phase3 = veyaSdk;
    const chain = veyaSdk;
    const plan = phase3.mainnetDeployPlan();
    if (plan.broadcast !== false || plan.settlementLive !== false) {
      return { status: "bug", detail: "deploy plan would broadcast" };
    }
    if (phase3.guestUseOnMainnetAllowed({}) || phase3.guestUseOnMainnetAllowed({ VEYA_MAINNET_GUEST_KILL: "0" })) {
      return { status: "bug", detail: "guest use opened" };
    }
    try {
      phase3.assertRealEthSpend(chain.MAINNET_MAX_FEE_WEI + 1n);
      return { status: "bug", detail: "spend past the cap did not throw" };
    } catch (err) {
      if (codeOf(err) !== "FEE_CAP") return { status: "bug", detail: `spend cap code ${codeOf(err) || "none"}` };
    }
    if (phase3.mainnetIncident("FEE_CAP").status !== 402) return { status: "bug", detail: "fee incident is not 402" };
    if (phase3.mainnetIncident("GUEST_TESTNET_ONLY").status !== 403) return { status: "bug", detail: "guest incident is not 403" };
    try {
      phase3.assertReceiptChain(46630, 4663);
      return { status: "bug", detail: "a mismatched receipt was accepted" };
    } catch (err) {
      if (codeOf(err) !== "RECEIPT_CHAIN") return { status: "bug", detail: `receipt code ${codeOf(err) || "none"}` };
    }
    return { status: "pass", detail: "plan stays dry, guest stays closed, FEE_CAP 402, RECEIPT_CHAIN" };
  });

  await record("host", "live", "Public host on mainnet", "Health reports the SDK mainnet chain", async () => {
    const res = await fetch(`${MCP_ORIGIN}/health`, { signal: AbortSignal.timeout(20_000) });
    const body = (await res.json()) as { chainId?: number; version?: string; network?: string };
    if (res.status !== 200) return { status: "bug", detail: `health HTTP ${res.status}` };
    if (body.chainId !== veyaSdk.ROBINHOOD_MAINNET_CHAIN_ID) return { status: "bug", detail: `public chain ${body.chainId ?? "missing"}` };
    return {
      status: "pass",
      detail: `chain ${body.chainId}, version ${body.version ?? "unset"}, network field ${body.network ?? "absent"}`,
    };
  });

  const counts = writeReport("phase3-tester-latest.json", { knownHolds });
  return counts;
}

async function main() {
  console.log(`[user-agent] MCP ${MCP} API ${API}`);
  console.log("[user-agent] no relayer key, no funding, no broadcast");

  let toolNames: string[] = [];
  let digest = "ab".repeat(32);
  let guestToken = "";
  let productKey = "";
  let userWallet: HDNodeWallet | null = null;
  let environmentId = "";
  let agentId = "";

  await record("arrive", "live", "Open the public service", "MCP and API health both answer", async () => {
    const [mcpRes, apiRes] = await Promise.all([
      fetch(`${MCP_ORIGIN}/health`, { signal: AbortSignal.timeout(15_000) }),
      fetch(`${API}/health`, { signal: AbortSignal.timeout(15_000) }),
    ]);
    const mcp = (await mcpRes.json().catch(() => ({}))) as Record<string, unknown>;
    const apiBody = (await apiRes.json().catch(() => ({}))) as Record<string, unknown>;
    const mcpOk = mcpRes.status === 200 && mcp.status === "ok";
    const apiOk = apiRes.status === 200;
    if (!mcpOk || !apiOk) {
      return { status: "bug", detail: `mcp HTTP ${mcpRes.status} api HTTP ${apiRes.status}` };
    }
    return {
      status: "pass",
      detail: `mcp HTTP 200 chain ${String(mcp.chainId ?? "unset")} api HTTP ${apiRes.status} db ${String(apiBody.db ?? apiBody.status ?? "ok")}`,
    };
  });

  await record("host", "live", "Public host serves mainnet", "Health reports the SDK mainnet chain", async () => {
    const res = await fetch(`${MCP_ORIGIN}/health`, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.json()) as Record<string, unknown>;
    const chain = Number(body.chainId);
    const settlement = String(body.settlement ?? "");
    if (chain !== veyaSdk.ROBINHOOD_MAINNET_CHAIN_ID && !settlement.includes(String(veyaSdk.ROBINHOOD_MAINNET_CHAIN_ID))) {
      return { status: "bug", detail: `chain ${String(body.chainId)} settlement ${settlement}` };
    }
    const network = body.network == null ? "network field absent" : `network ${String(body.network)}`;
    const version = String(body.version ?? "unknown");
    const gap = body.network == null;
    return {
      status: gap ? "gap" : "pass",
      detail: `version ${version} chain ${chain || settlement} ${network}. ${gap ? "The clone profile is not what this host serves." : "Host reports a network field."}`,
    };
  });

  await record("tools", "live", "List the tool surface", "Initialize and tools/list succeed", async () => {
    const init = await mcpPost({
      jsonrpc: "2.0",
      id: rpcId++,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "veya-user-agent", version: "0" },
      },
    });
    const listed = await mcpPost({ jsonrpc: "2.0", id: rpcId++, method: "tools/list", params: {} });
    toolNames = ((listed.json?.result?.tools as Array<{ name: string }>) ?? []).map((tool) => tool.name);
    const needed = ["veya_describe", "veya_guest_login", "veya_create_environment", "veya_account", "veya_store_commitment"];
    const missing = needed.filter((name) => !toolNames.includes(name));
    if (init.status !== 200 || !init.json?.result) {
      return { status: "bug", detail: `initialize HTTP ${init.status}` };
    }
    if (missing.length) {
      return { status: "bug", detail: `count ${toolNames.length} missing ${missing.join(",")}` };
    }
    return { status: "pass", detail: `${toolNames.length} tools, core user tools present` };
  });

  await record("reads", "live", "Stranger reads", "Describe, ping, and hash work with no key", async () => {
    const describe = await callTool("veya_describe");
    const ping = await callTool("veya_ping_chain");
    const hashed = await callTool("veya_hash_blake3", { data: `user-agent-${Date.now()}` });
    const hash = String(hashed.parsed?.hash ?? "").replace(/^0x/, "");
    if (hash.length >= 64) digest = hash;
    const pingText = hashed.text && ping.text;
    const chainOk = ping.text.includes(String(veyaSdk.ROBINHOOD_MAINNET_CHAIN_ID));
    const describeOk = !describe.isError && describe.text.length > 20;
    const hashOk = !hashed.isError && hash.length >= 64;
    if (!describeOk || !hashOk || !pingText) {
      return { status: "bug", detail: `describe error=${describe.isError} hash=${hash.length} ping=${clip(ping.text, 80)}` };
    }
    if (!chainOk) {
      return { status: "bug", detail: `ping did not report the mainnet chain: ${clip(ping.text, 120)}` };
    }
    return { status: "pass", detail: "describe, ping mainnet, and a 32-byte hash" };
  });

  await record("registry", "live", "Public registry", "Stats and the public agent list answer below HTTP 500", async () => {
    const stats = await callTool("veya_public_stats");
    const agents = await callTool("veya_public_list_agents", { limit: 3, offset: 0 });
    const statsStatus = Number(stats.parsed?.httpStatus ?? (stats.isError ? 500 : 200));
    const agentsStatus = Number(agents.parsed?.httpStatus ?? (agents.isError ? 500 : 200));
    if (statsStatus >= 500 || agentsStatus >= 500) {
      return { status: "bug", detail: `stats ${statsStatus} agents ${agentsStatus}` };
    }
    return { status: "pass", detail: `stats ${statsStatus} agents ${agentsStatus}` };
  });

  await record("chain-read", "live", "On-chain read", "An environment read returns JSON and does not throw a BigInt serialize error", async () => {
    const read = await callTool("veya_read_environment_onchain", {
      environmentUuidHex: "7d0af0ba2ae34d0ebc750bbaccb3dd71",
    });
    if (read.text.includes("serialize a BigInt") || read.text.includes("BigInt")) {
      return { status: "bug", detail: clip(read.text, 160) };
    }
    if (read.isError) return { status: "bug", detail: clip(read.text, 160) };
    return { status: "pass", detail: "environment read returned JSON" };
  });

  await record("guest", "live", "Guest session", "Guest login returns a listing token", async () => {
    const guest = await callTool("veya_guest_login");
    guestToken = String(guest.parsed?.body?.token || guest.parsed?.token || "");
    const http = Number(guest.parsed?.httpStatus ?? 0);
    if (guest.isError || http !== 200 || !guestToken) {
      return { status: "bug", detail: `error=${guest.isError} http=${http || "none"} token=${guestToken ? "yes" : "no"}` };
    }
    return { status: "pass", detail: "HTTP 200 and a listing token" };
  });

  await record("guest-list", "live", "Guest can list", "The listing token can read environments", async () => {
    if (!guestToken) return { status: "blocked", detail: "guest login did not return a token" };
    const listed = await callTool("veya_list_environments", { apiKey: guestToken });
    const http = Number(listed.parsed?.httpStatus ?? 0);
    if (listed.isError && http >= 500) return { status: "bug", detail: `HTTP ${http}` };
    if (listed.isError && http === 0) return { status: "bug", detail: clip(listed.text, 160) };
    return { status: "pass", detail: listed.isError ? clip(listed.text, 120) : `HTTP ${http || 200}` };
  });

  await record("guest-stop", "live", "Guest build is refused", "Guest cannot create an environment from MCP or the API", async () => {
    if (!guestToken) return { status: "blocked", detail: "guest login did not return a token" };
    const mcpCreate = await callTool("veya_create_environment", {
      apiKey: guestToken,
      name: "user-agent-guest",
      type: "research",
    });
    const apiCreate = await api("/v1/environments", {
      method: "POST",
      token: guestToken,
      body: JSON.stringify({ name: "user-agent-guest", type: "research" }),
    });
    const mcpRefused = mcpCreate.isError;
    const apiStatus = apiCreate.status;
    if (!mcpRefused) return { status: "bug", detail: "MCP accepted a guest create" };
    if (apiStatus === 201 || apiStatus === 200) return { status: "bug", detail: `API created an environment for a guest (HTTP ${apiStatus})` };
    if (apiStatus === 403) return { status: "pass", detail: "MCP refused and API returned 403" };
    return {
      status: "bug",
      detail: `MCP refused, API returned ${apiStatus} ${clip(String(apiCreate.body?.error ?? apiCreate.body?.code ?? ""))}. Guest build is specified as 403.`,
    };
  });

  await record("signin", "live", "Wallet sign-in", "A fresh wallet receives a session", async () => {
    const user = Wallet.createRandom();
    userWallet = user;
    const nonce = await api(`/auth/nonce?wallet=${encodeURIComponent(user.address)}`);
    if (nonce.status !== 200 || typeof nonce.body?.message !== "string") {
      return { status: "bug", detail: `nonce HTTP ${nonce.status}` };
    }
    const signature = await user.signMessage(nonce.body.message);
    const verify = await api("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ wallet: user.address, message: nonce.body.message, signature }),
    });
    const token = typeof verify.body?.token === "string" ? verify.body.token : "";
    if (verify.status !== 200 || !token) return { status: "bug", detail: `verify HTTP ${verify.status}` };
    const minted = await api("/v1/api-keys", {
      method: "POST",
      token,
      body: JSON.stringify({ name: `user-agent-${Date.now()}`, tier: "dev" }),
    });
    productKey = String(minted.body?.apiKey?.key ?? "");
    if (minted.status !== 201 || !productKey.startsWith("veya_dev_")) {
      return { status: "bug", detail: `mint HTTP ${minted.status}` };
    }
    return { status: "pass", detail: "nonce, verify, and a dev key. The key is not stored in this report." };
  });

  await record("account", "live", "Account matches the wallet", "The product key is bound to the signing wallet", async () => {
    if (!productKey || !userWallet) return { status: "blocked", detail: "sign-in did not mint a key" };
    const acct = await callTool("veya_account", { apiKey: productKey });
    const wallet = String(acct.parsed?.body?.wallet ?? "");
    if (acct.isError || wallet.toLowerCase() !== userWallet.address.toLowerCase()) {
      return { status: "bug", detail: acct.isError ? clip(acct.text, 140) : "wallet field did not match the signer" };
    }
    return { status: "pass", detail: "account wallet matches the signer" };
  });

  await record("room", "live", "Create an environment", "A product key can open a room without a chain write", async () => {
    if (!productKey) return { status: "blocked", detail: "no product key" };
    const created = await callTool("veya_create_environment", {
      apiKey: productKey,
      name: `user-agent-${Date.now()}`,
      type: "research",
    });
    environmentId = String(created.parsed?.body?.id || created.parsed?.body?.environment?.id || "");
    const http = Number(created.parsed?.httpStatus ?? 0);
    if (created.isError || !environmentId || http >= 400) {
      return { status: "bug", detail: clip(created.text, 160) || `HTTP ${http}` };
    }
    if (/veya_(dev|live)_/.test(created.text) || /eyJ[A-Za-z0-9_-]+\./.test(created.text)) {
      return { status: "bug", detail: "create response echoed a credential" };
    }
    const got = await callTool("veya_get_environment", { apiKey: productKey, environmentId });
    if (got.isError) return { status: "bug", detail: `created ${environmentId} but get failed` };
    return { status: "pass", detail: `created and read back ${environmentId}` };
  });

  await record("agent", "live", "Deploy an agent", "The new room accepts an agent", async () => {
    if (!productKey || !environmentId) return { status: "blocked", detail: "no environment" };
    const deployed = await callTool("veya_deploy_agent", {
      apiKey: productKey,
      environmentId,
      type: "research",
      agentKind: "researcher",
    });
    agentId = String(deployed.parsed?.body?.id || deployed.parsed?.body?.agent?.id || "");
    const http = Number(deployed.parsed?.httpStatus ?? 0);
    if (deployed.isError || http >= 400 || !agentId) {
      return { status: "bug", detail: clip(deployed.text, 160) || `HTTP ${http}` };
    }
    return { status: "pass", detail: `agent ${agentId}` };
  });

  await record("records", "live", "List proofs and runs", "Memory, executions, and proofs stay under HTTP 500", async () => {
    if (!productKey || !environmentId) return { status: "blocked", detail: "no environment" };
    const memory = await callTool("veya_list_api_memory", { apiKey: productKey, environmentId });
    const executions = await callTool("veya_list_executions", { apiKey: productKey, environmentId });
    const proofs = await callTool("veya_list_proofs", { apiKey: productKey });
    const rows = [
      ["memory", memory],
      ["executions", executions],
      ["proofs", proofs],
    ] as const;
    const bad = rows.filter(([, row]) => {
      const http = Number(row.parsed?.httpStatus ?? (row.isError ? 500 : 200));
      return http >= 500;
    });
    if (bad.length) {
      return { status: "bug", detail: bad.map(([name, row]) => `${name} ${clip(row.text, 60)}`).join("; ") };
    }
    return { status: "pass", detail: "memory, executions, and proofs answered" };
  });

  await record("run", "live", "Protected run", "A protected run answers, or fails closed, without HTTP 500", async () => {
    if (!productKey || !environmentId || !agentId) return { status: "blocked", detail: "no agent" };
    const run = await callTool(
      "veya_run_protected_execution",
      {
        apiKey: productKey,
        environmentId,
        agentId,
        eventType: "user-agent",
        payload: { n: 1 },
      },
      40_000,
    );
    const http = Number(run.parsed?.httpStatus ?? (run.isError ? 0 : 200));
    if (http >= 500) return { status: "bug", detail: clip(run.text, 160) };
    const txHash = run.parsed?.txHash || run.parsed?.body?.txHash;
    if (txHash) return { status: "bug", detail: "protected run returned a transaction hash on an unfunded account" };
    return { status: "pass", detail: run.isError ? `fail closed: ${clip(run.text, 140)}` : `HTTP ${http}` };
  });

  await record("payer-match", "live", "Wrong payer is refused", "A key from a different wallet cannot write", async () => {
    if (!productKey) return { status: "blocked", detail: "no product key" };
    const other = Wallet.createRandom();
    const write = await callTool("veya_store_commitment", {
      apiKey: productKey,
      payerPrivateKey: other.privateKey,
      environmentUuidHex: "0".repeat(32),
      commitmentHex: digest,
    });
    const txHash = write.parsed?.txHash || write.parsed?.body?.txHash;
    if (txHash) return { status: "bug", detail: "a mismatched payer received a transaction hash" };
    if (!write.isError || !/does not match/i.test(write.text)) {
      return { status: "bug", detail: clip(write.text, 160) || "mismatch was not refused" };
    }
    return { status: "pass", detail: "mismatched payer refused, no transaction hash" };
  });

  await record("write-stop", "live", "Unfunded write stops", "The signing wallet has no balance, so the write is refused and nothing is sent", async () => {
    if (!productKey || !userWallet) return { status: "blocked", detail: "no signing wallet" };
    const write = await callTool("veya_store_commitment", {
      apiKey: productKey,
      payerPrivateKey: userWallet.privateKey,
      environmentUuidHex: "0".repeat(32),
      commitmentHex: digest,
    });
    const txHash = write.parsed?.txHash || write.parsed?.body?.txHash;
    if (txHash) return { status: "bug", detail: "the unfunded signing wallet received a transaction hash" };
    if (!write.isError) return { status: "bug", detail: "the write tool returned success for an unfunded wallet" };
    if (/does not match/i.test(write.text)) {
      return { status: "bug", detail: "the matching wallet was refused as a mismatch, so the balance check never ran" };
    }
    return { status: "pass", detail: clip(write.text, 160) };
  });

  await record("gates", "clone", "Phase 3 gates in the clone", "Empty contract, guest, fee, receipt, and deploy plan stop before a send", async () => {
    const phase3 = veyaSdk;
    const chain = veyaSdk;
    const seal = veyaSdk;
    const evm = veyaSdk;
    const notes: string[] = [];

    const plan = phase3.mainnetDeployPlan();
    if (plan.broadcast !== false || plan.contractAddress !== "" || plan.settlementLive !== false) {
      return { status: "bug", detail: "deploy plan would broadcast or marks settlement live" };
    }
    notes.push("deploy plan does not broadcast");

    if (phase3.guestUseOnMainnetAllowed({})) {
      return { status: "bug", detail: "guest use is open by default" };
    }
    if (phase3.guestUseOnMainnetAllowed({ VEYA_MAINNET_GUEST_KILL: "0" })) {
      return { status: "bug", detail: "clearing the kill switch opened guest use" };
    }
    notes.push("guest use stays closed");

    const unfunded = phase3.mainnetFundingStatus({ keyConfigured: false, balanceWei: 1n });
    const zero = phase3.mainnetFundingStatus({ keyConfigured: true, balanceWei: 0n });
    if (unfunded.ready || zero.ready || unfunded.separateFromTestnet !== true) {
      return { status: "bug", detail: "funding check treated a missing or empty payer as ready" };
    }
    notes.push("dedicated payer unready");

    try {
      phase3.assertRealEthSpend(chain.MAINNET_MAX_FEE_WEI + 1n);
      return { status: "bug", detail: "spend past the cap did not throw" };
    } catch (err) {
      if (codeOf(err) !== "FEE_CAP") return { status: "bug", detail: `spend cap code ${codeOf(err) || "none"}` };
    }
    notes.push("spend cap");

    if (phase3.mainnetIncident("FEE_CAP").status !== 402) return { status: "bug", detail: "fee incident is not 402" };
    if (phase3.mainnetIncident("GUEST_TESTNET_ONLY").status !== 403) return { status: "bug", detail: "guest incident is not 403" };
    if (phase3.mainnetIncident("MAINNET_UNPUBLISHED").status !== 503) return { status: "bug", detail: "unpublished incident is not 503" };
    notes.push("402/403/503");

    try {
      phase3.assertReceiptChain(46630, 4663);
      return { status: "bug", detail: "a mismatched receipt was accepted" };
    } catch (err) {
      if (codeOf(err) !== "RECEIPT_CHAIN") return { status: "bug", detail: `receipt code ${codeOf(err) || "none"}` };
    }
    notes.push("proof lock");

    const dummy = `0x${"11".repeat(32)}`;
    try {
      new evm.EvmAnchor({ network: "mainnet", contractAddress: "", payerPrivateKey: dummy });
      return { status: "bug", detail: "empty contract constructed an anchor" };
    } catch (err) {
      if (codeOf(err) !== "MAINNET_UNPUBLISHED") return { status: "bug", detail: `anchor code ${codeOf(err) || "none"}` };
    }
    notes.push("stop before send");

    let committed = false;
    try {
      await seal.sealDecision(
        { evidenceId: "user-agent", decision: { outcome: "allow" } },
        {
          network: "mainnet",
          guest: true,
          payerPrivateKey: dummy,
          contractAddress: "0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84",
        },
        {
          runSealed: async () => ({
            output_blake3_hash: "ab".repeat(32),
            mldsa_signature: "cd",
            verified: true,
            sealed: { ciphertext: [], blake3_commitment: "ab".repeat(32), context_label: "veya.sealed.decision" },
          }),
          runQuorum: async () => ({
            task_id: "user-agent",
            agreed_blake3_hash: "ef".repeat(32),
            consensus_reached: true,
            threshold: 2,
            reachable: 3,
            node_results: [
              { node_id: "alpha", blake3_execution_hash: "ef".repeat(32), mldsa_signature: "aa", status: "success" },
              { node_id: "beta", blake3_execution_hash: "ef".repeat(32), mldsa_signature: "bb", status: "success" },
            ],
          }),
          commit: async () => {
            committed = true;
            return { txHash: `0x${"22".repeat(32)}`, blockNumber: 1, explorerUrl: "https://example.invalid" };
          },
        },
      );
      return { status: "bug", detail: "guest seal returned instead of refusing" };
    } catch (err) {
      if (codeOf(err) !== "GUEST_TESTNET_ONLY" || committed) {
        return { status: "bug", detail: `guest seal code ${codeOf(err) || "none"} committed=${committed}` };
      }
    }
    notes.push("guest seal does not commit");
    return { status: "pass", detail: notes.join(", ") };
  });

  writeReport("user-agent-latest.json");
}

const entry = process.argv.includes("--phase3") ? phase3Audit : main;
entry().catch((err) => {
  console.error("[user-agent] fatal", redact(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
