/**
 * Live product-key + user-paid write proof against api.veyanet.tech + local MCP 1.2.1.
 * Does not print secrets. Uses a throwaway wallet as the user; funds it from the
 * operator relayer only so we can prove explorer `from` is NOT the relayer.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { loadConfig, MCP_SERVICE_VERSION } from "../src/config.js";
import { createHttpApp } from "../src/http.js";
import { NO_TESTNET_TOKENS } from "../src/credentials.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = (process.env.VEYA_API_URL || "https://api.veyanet.tech").replace(/\/$/, "");
const RPC = "https://rpc.testnet.chain.robinhood.com";
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const BACKEND_ENV = resolve(__dirname, "../../backend/.env");

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

async function callTool(port: number, id: number, name: string, args: Record<string, unknown> = {}) {
  return mcpPost(port, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

function log(ok: boolean, label: string, detail?: string) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function apiJson(
  path: string,
  init: RequestInit & { apiKey?: string; token?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
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

async function walletLogin(user: ethers.Wallet): Promise<string> {
  const nonce = await apiJson(`/auth/nonce?wallet=${encodeURIComponent(user.address)}`);
  if (nonce.status !== 200 || typeof nonce.body?.message !== "string") {
    throw new Error(`nonce failed HTTP ${nonce.status}`);
  }
  const signature = await user.signMessage(nonce.body.message);
  const verify = await apiJson("/auth/verify", {
    method: "POST",
    body: JSON.stringify({
      wallet: user.address,
      message: nonce.body.message,
      signature,
    }),
  });
  if (verify.status !== 200 || typeof verify.body?.token !== "string") {
    throw new Error(`wallet verify failed HTTP ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  return verify.body.token as string;
}

const results: Array<{ name: string; ok: boolean; note: string }> = [];
function check(name: string, ok: boolean, note = "") {
  results.push({ name, ok, note });
  log(ok, name, note);
}

async function main() {
  const backend = loadNamedEnv(BACKEND_ENV, ["VEYA_RELAYER_PRIVATE_KEY"]);
  assert.ok(backend.VEYA_RELAYER_PRIVATE_KEY, "backend .env relayer key missing");
  const relayer = new ethers.Wallet(backend.VEYA_RELAYER_PRIVATE_KEY);
  const user = ethers.Wallet.createRandom();
  const other = ethers.Wallet.createRandom();
  const provider = new ethers.JsonRpcProvider(RPC);
  const relayerConnected = relayer.connect(provider);

  console.log(`[live] MCP ${MCP_SERVICE_VERSION} → ${API}`);
  console.log(`[live] user=${user.address}`);
  console.log(`[live] relayer=${relayer.address}`);
  console.log(`[live] other=${other.address} (mismatch payer)`);

  const relayerBal = await provider.getBalance(relayer.address);
  const userBal0 = await provider.getBalance(user.address);
  console.log(`[live] relayerBalWei=${relayerBal.toString()} userBalWei=${userBal0.toString()}`);
  check("user wallet is not the relayer", user.address.toLowerCase() !== relayer.address.toLowerCase());
  check("fresh user starts at 0 wei", userBal0 === 0n);

  const token = await walletLogin(user);
  check("wallet login JWT", Boolean(token), "mode=wallet");

  const minted = await apiJson("/v1/api-keys", {
    method: "POST",
    token,
    body: JSON.stringify({ name: `mcp-live-${Date.now()}`, tier: "dev" }),
  });
  const apiKey = minted.body?.apiKey?.key as string | undefined;
  check(
    "mint product API key",
    minted.status === 201 && typeof apiKey === "string" && apiKey.startsWith("veya_dev_"),
    `http=${minted.status} prefix=${typeof apiKey === "string" ? apiKey.slice(0, 9) : "none"}`,
  );
  if (!apiKey) throw new Error("could not mint product API key");

  const account = await apiJson("/v1/account", { apiKey });
  const accountWallet = String(account.body?.wallet ?? "");
  check(
    "GET /v1/account wallet matches user",
    account.status === 200 && accountWallet.toLowerCase() === user.address.toLowerCase(),
    `http=${account.status} isGuest=${account.body?.isGuest ?? "?"}`,
  );

  process.env.VEYA_API_URL = API;
  delete process.env.MCP_API_KEY;
  delete process.env.VEYA_RELAYER_PRIVATE_KEY;
  delete process.env.VEYA_DEPLOYER_PRIVATE_KEY;
  delete process.env.VEYA_PAYER_PRIVATE_KEY;

  const existingPort = Number(process.env.MCP_PORT || 0);
  let server: ReturnType<ReturnType<typeof createHttpApp>["listen"]> | null = null;
  let port = existingPort;
  if (!port) {
    const cfg = loadConfig();
    const app = createHttpApp(cfg);
    server = app.listen(0);
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    port = addr.port;
  }
  console.log(`[live] MCP port=${port} existing=${Boolean(existingPort)}`);

  try {
    const init = await mcpPost(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "live-workflow", version: "1.2.1" },
      },
    });
    check("MCP initialize", init.status === 200);

    const describe = await callTool(port, 2, "veya_describe");
    const dt = toolText(describe.json);
    check("describe no key", dt.includes("@veyanet/mcp") && dt.includes("46630") && !isError(describe.json));

    const ping = await callTool(port, 3, "veya_ping_chain");
    const pt = toolText(ping.json);
    check("ping chain 46630", pt.includes("46630") && !isError(ping.json));

    const listed = await callTool(port, 4, "veya_list_environments", { apiKey });
    const lt = toolText(listed.json);
    check(
      "valid key lists rooms",
      listed.status === 200 && !isError(listed.json) && lt.includes("httpStatus") && /200/.test(lt),
      isError(listed.json) ? lt.slice(0, 160).replace(/\s+/g, " ") : "ok",
    );

    const created = await callTool(port, 5, "veya_create_environment", {
      apiKey,
      name: `mcp-live-${Date.now()}`,
      type: "research",
    });
    const ct = toolText(created.json);
    let environmentId = "";
    try {
      const parsed = JSON.parse(ct);
      environmentId = parsed?.body?.id || parsed?.body?.environment?.id || parsed?.id || "";
    } catch {
      environmentId = "";
    }
    check(
      "create environment (API row, no gas)",
      created.status === 200 && !isError(created.json) && Boolean(environmentId),
      environmentId ? `id=${environmentId}` : ct.slice(0, 180).replace(/\s+/g, " "),
    );

    const unfunded = await callTool(port, 6, "veya_store_commitment", {
      apiKey,
      payerPrivateKey: user.privateKey,
      environmentUuidHex: "0".repeat(32),
      commitmentHex: "a".repeat(64),
    });
    const ut = toolText(unfunded.json);
    check(
      "valid key + empty matching wallet → exact tokens sentence",
      isError(unfunded.json) && ut.includes(NO_TESTNET_TOKENS),
      ut.slice(0, 180).replace(/\s+/g, " "),
    );

    const mismatch = await callTool(port, 7, "veya_store_commitment", {
      apiKey,
      payerPrivateKey: other.privateKey,
      environmentUuidHex: "0".repeat(32),
      commitmentHex: "a".repeat(64),
    });
    const mt = toolText(mismatch.json);
    check(
      "payer does not match API key wallet",
      isError(mismatch.json) && mt.toLowerCase().includes("does not match the wallet"),
      mt.slice(0, 180).replace(/\s+/g, " "),
    );

    if (relayerBal === 0n) {
      check("fund user from relayer", false, "relayer has 0 wei");
    } else {
      const fundWei = ethers.parseEther("0.002");
      const sendAmt = relayerBal > fundWei * 2n ? fundWei : relayerBal / 4n;
      const fundTx = await relayerConnected.sendTransaction({
        to: user.address,
        value: sendAmt,
      });
      console.log(`[live] fundTx=${fundTx.hash}`);
      const fundRcpt = await fundTx.wait(1);
      const userBal1 = await provider.getBalance(user.address);
      check(
        "fund throwaway user from relayer",
        Boolean(fundRcpt?.hash) && userBal1 > 0n,
        `userBalWei=${userBal1.toString()}`,
      );

      if (!environmentId) {
        check("registerEnvironment user-paid", false, "no environmentId");
      } else {
        const reg = await callTool(port, 8, "veya_register_environment", {
          apiKey,
          payerPrivateKey: user.privateKey,
          environmentId,
          envType: 0,
        });
        const rt = toolText(reg.json);
        let txHash = "";
        let from = "";
        let consoleSynced: boolean | undefined;
        try {
          const parsed = JSON.parse(rt);
          txHash = parsed.txHash || "";
          from = parsed.from || "";
          consoleSynced = parsed.consoleSynced;
        } catch {
          /* ignore */
        }
        const onchain = txHash && !isError(reg.json);
        check(
          "registerEnvironment returned tx",
          Boolean(onchain && from),
          onchain ? `from=${from} synced=${String(consoleSynced)}` : rt.slice(0, 220).replace(/\s+/g, " "),
        );

        if (txHash) {
          const mined = await provider.waitForTransaction(txHash, 1, 120_000);
          const tx = await provider.getTransaction(txHash);
          const rpcFrom = tx?.from ?? "";
          const fromIsUser = rpcFrom.toLowerCase() === user.address.toLowerCase();
          const fromIsNotRelayer = rpcFrom.toLowerCase() !== relayer.address.toLowerCase();
          check(
            "RPC tx.from is the user wallet",
            Boolean(mined && fromIsUser && fromIsNotRelayer),
            `rpcFrom=${rpcFrom} status=${mined?.status} explorer=${EXPLORER}/tx/${txHash}`,
          );
          check(
            "consoleSynced after confirm-registration",
            consoleSynced === true,
            `consoleSynced=${String(consoleSynced)}`,
          );
        }
      }
    }
  } finally {
    if (server) {
      await new Promise<void>((resolveClose, reject) =>
        server!.close((err) => (err ? reject(err) : resolveClose())),
      );
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n=== LIVE WORKFLOW SUMMARY ===");
  console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
  for (const f of failed) console.log(`  FAIL ${f.name} (${f.note})`);
  if (failed.length) process.exit(1);
  console.log("ALL LIVE CHECKS PASSED");
}

main().catch((err) => {
  console.error("[live] fatal", err instanceof Error ? err.message : err);
  process.exit(1);
});
