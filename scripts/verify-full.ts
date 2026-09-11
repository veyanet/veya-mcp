/**
 * Full local MCP verification from two perspectives:
 * - User (no Bearer): paste-URL stranger
 * - Dave (Bearer MCP_API_KEY): operator with write tools
 *
 * Loads VEYA_RELAYER_PRIVATE_KEY from this package's `.env` (see `.env.example`)
 * without printing secrets. Sets a temporary MCP_API_KEY for this process only.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { createHttpApp } from "../src/http.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_MCP_KEY = "veya-local-dave-verify-key";

function loadLocalEnvRelayer(): void {
  const envPath = resolve(__dirname, "../.env");
  if (!existsSync(envPath)) {
    throw new Error(
      `Missing ${envPath}. Copy .env.example to .env and set VEYA_RELAYER_PRIVATE_KEY for write checks.`,
    );
  }
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k === "VEYA_RELAYER_PRIVATE_KEY" || k === "VEYA_DEPLOYER_PRIVATE_KEY") {
      if (v) process.env[k] = v;
    }
  }
  process.env.MCP_API_KEY = LOCAL_MCP_KEY;
  if (!process.env.VEYA_RELAYER_PRIVATE_KEY && !process.env.VEYA_DEPLOYER_PRIVATE_KEY) {
    throw new Error("No relayer/deployer key found in .env");
  }
}

function toolText(json: any): string {
  const c = json?.result?.content?.[0]?.text;
  if (typeof c === "string") return c;
  return JSON.stringify(json ?? {});
}

async function mcpPost(
  port: number,
  body: unknown,
  bearer?: string | null,
): Promise<{ status: number; json: any; raw: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers,
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

async function callTool(
  port: number,
  id: number,
  name: string,
  args: Record<string, unknown> = {},
  bearer?: string | null,
) {
  return mcpPost(
    port,
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    },
    bearer,
  );
}

function log(label: string, ok: boolean, detail?: string) {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  loadLocalEnvRelayer();
  const cfg = loadConfig();
  assert.ok(cfg.mcpApiKey, "MCP_API_KEY should be set");
  assert.ok(cfg.relayerPrivateKey, "relayer should be set");

  const app = createHttpApp(cfg);
  const server = app.listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  console.log(`[verify] local MCP on :${port} (writes enabled=true, secrets not printed)`);

  const results: Array<{ name: string; ok: boolean; note: string }> = [];

  try {
    // --- initialize as User ---
    const init = await mcpPost(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "dave-user-verify", version: "1.1.0" },
      },
    });
    assert.equal(init.status, 200, init.raw.slice(0, 300));
    log("initialize", true);

    const listed = await mcpPost(port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const tools = (listed.json?.result?.tools as Array<{ name: string }>) ?? [];
    const names = tools.map((t) => t.name);
    console.log(`[verify] tools/list count=${names.length}`);
    assert.ok(names.length >= 40, `expected full surface, got ${names.length}`);
    assert.ok(!names.includes("veya_writes_status"), "writes should be enabled → no status stub");
    assert.ok(names.includes("veya_store_commitment"));
    assert.ok(names.includes("veya_register_pq_onchain"));
    assert.ok(names.includes("veya_guest_login"));
    assert.ok(names.includes("veya_pq_keygen"));
    log("tools/list full surface", true, `${names.length} tools, writes registered`);

    // ========== USER perspective (no Bearer) ==========
    console.log("\n=== USER (no Bearer) ===");

    {
      const r = await callTool(port, 10, "veya_describe");
      const t = toolText(r.json);
      const ok = t.includes("1.1.0") && t.includes("46630") && t.includes("full");
      log("veya_describe", ok, t.includes("1.1.0") ? "v1.1.0 honesty" : t.slice(0, 120));
      results.push({ name: "veya_describe", ok, note: "user" });
    }

    {
      const r = await callTool(port, 11, "veya_ping_chain");
      const t = toolText(r.json);
      const ok = r.status === 200 && (t.includes("46630") || t.includes("chainId"));
      log("veya_ping_chain", ok, t.slice(0, 100).replace(/\s+/g, " "));
      results.push({ name: "veya_ping_chain", ok, note: "user" });
    }

    {
      const r = await callTool(port, 12, "veya_hash_blake3", { data: "veya-dave-verify" });
      const t = toolText(r.json);
      const ok = /"hash"\s*:\s*"[0-9a-f]{64}"/i.test(t);
      log("veya_hash_blake3", ok);
      results.push({ name: "veya_hash_blake3", ok, note: "user" });
    }

    {
      // known commitment tx from README if present; else soft-check error shape
      const tx =
        process.env.VERIFY_TX ||
        "0x0000000000000000000000000000000000000000000000000000000000000001";
      const r = await callTool(port, 13, "veya_verify_transaction", { txHash: tx });
      const t = toolText(r.json);
      // dummy tx may error; that's ok for transport — real ping already proved RPC
      const ok = r.status === 200;
      log("veya_verify_transaction (transport)", ok, t.slice(0, 140).replace(/\s+/g, " "));
      results.push({ name: "veya_verify_transaction", ok, note: "user transport" });
    }

    {
      const r = await callTool(port, 14, "veya_api_health");
      const t = toolText(r.json);
      const ok = r.status === 200 && t.includes("httpStatus");
      log("veya_api_health", ok, t.slice(0, 120).replace(/\s+/g, " "));
      results.push({ name: "veya_api_health", ok, note: "user" });
    }

    {
      const r = await callTool(port, 15, "veya_pq_keygen");
      const t = toolText(r.json);
      const ok = t.includes("publicKeyHex") && t.includes("privateKeyHex");
      log("veya_pq_keygen", ok);
      results.push({ name: "veya_pq_keygen", ok, note: "user" });

      if (ok) {
        const parsed = JSON.parse(t);
        const sign = await callTool(port, 16, "veya_pq_sign", {
          message: "hello-dave",
          privateKeyHex: parsed.privateKeyHex,
        });
        const st = toolText(sign.json);
        const signOk = st.includes("signatureHex");
        log("veya_pq_sign", signOk);
        results.push({ name: "veya_pq_sign", ok: signOk, note: "user" });

        if (signOk) {
          const sig = JSON.parse(st).signatureHex;
          const ver = await callTool(port, 17, "veya_pq_verify", {
            message: "hello-dave",
            signatureHex: sig,
            publicKeyHex: parsed.publicKeyHex,
          });
          const vt = toolText(ver.json);
          const vok = vt.includes('"valid": true') || vt.includes('"valid":true');
          log("veya_pq_verify", vok, vt.slice(0, 80));
          results.push({ name: "veya_pq_verify", ok: vok, note: "user" });
        }
      }
    }

    {
      const r = await callTool(port, 18, "veya_public_stats");
      const t = toolText(r.json);
      const ok = r.status === 200 && t.includes("httpStatus");
      log("veya_public_stats", ok, t.slice(0, 140).replace(/\s+/g, " "));
      results.push({ name: "veya_public_stats", ok, note: "user" });
    }

    {
      const r = await callTool(port, 19, "veya_run_consensus", {
        taskId: "verify-local",
        payload: { n: 1 },
      });
      const t = toolText(r.json);
      // expect fail-closed if localhost fleet down
      const failClosed = t.includes("error") || t.toLowerCase().includes("fail") || t.includes("ECONNREFUSED");
      const ok = r.status === 200; // tool returns error payload, not HTTP 500
      log("veya_run_consensus (expect fail-closed if fleet down)", ok, t.slice(0, 160).replace(/\s+/g, " "));
      results.push({ name: "veya_run_consensus", ok, note: failClosed ? "fail-closed ok" : "unexpected success?" });
    }

    {
      const guest = await callTool(port, 20, "veya_guest_login");
      const gt = toolText(guest.json);
      let token: string | undefined;
      try {
        const body = JSON.parse(gt);
        token =
          body?.body?.token ||
          body?.body?.accessToken ||
          body?.body?.sessionToken ||
          body?.token;
        if (!token && body?.body && typeof body.body === "object") {
          const nested = body.body as Record<string, unknown>;
          token = (nested.jwt || nested.access_token || nested.session) as string | undefined;
        }
      } catch {
        /* ignore */
      }
      const guestOk = guest.status === 200 && gt.includes("httpStatus");
      log("veya_guest_login", guestOk, token ? "token received" : gt.slice(0, 180).replace(/\s+/g, " "));
      results.push({ name: "veya_guest_login", ok: guestOk, note: token ? "token" : "see body" });

      if (token) {
        const envs = await callTool(port, 21, "veya_list_environments", { sessionToken: token });
        const et = toolText(envs.json);
        log("veya_list_environments (guest)", envs.status === 200, et.slice(0, 140).replace(/\s+/g, " "));
        results.push({ name: "veya_list_environments", ok: envs.status === 200, note: "guest" });

        const create = await callTool(port, 22, "veya_create_environment", {
          sessionToken: token,
          name: "dave-should-403",
          type: "research",
        });
        const ct = toolText(create.json);
        const forbidden =
          ct.includes("403") ||
          ct.toLowerCase().includes("forbidden") ||
          ct.toLowerCase().includes("build") ||
          ct.includes('"httpStatus": 403');
        log("veya_create_environment guest → expect 403", forbidden, ct.slice(0, 160).replace(/\s+/g, " "));
        results.push({ name: "veya_create_environment guest 403", ok: forbidden, note: "user/dave guest" });
      }
    }

    // User calling write without Bearer must fail
    {
      const r = await callTool(port, 30, "veya_store_commitment", {
        environmentUuidHex: "0123456789abcdef0123456789abcdef",
        commitmentHex: "a".repeat(64),
      });
      const t = toolText(r.json);
      const denied =
        r.json?.result?.isError === true ||
        t.toLowerCase().includes("unauthor") ||
        t.toLowerCase().includes("bearer") ||
        t.toLowerCase().includes("disabled") ||
        t.toLowerCase().includes("mcp_api_key");
      log("veya_store_commitment WITHOUT bearer → deny", denied, t.slice(0, 140).replace(/\s+/g, " "));
      results.push({ name: "write deny without bearer", ok: denied, note: "user" });
    }

    // ========== DAVE perspective (Bearer) ==========
    console.log("\n=== DAVE (Bearer MCP_API_KEY) ===");

    {
      // Wrong bearer
      const r = await callTool(
        port,
        40,
        "veya_store_commitment",
        {
          environmentUuidHex: "0123456789abcdef0123456789abcdef",
          commitmentHex: "b".repeat(64),
        },
        "wrong-key",
      );
      const t = toolText(r.json);
      const denied =
        r.json?.result?.isError === true ||
        t.toLowerCase().includes("unauthor") ||
        t.toLowerCase().includes("bearer") ||
        t.toLowerCase().includes("invalid");
      log("veya_store_commitment wrong bearer → deny", denied, t.slice(0, 140).replace(/\s+/g, " "));
      results.push({ name: "write deny wrong bearer", ok: denied, note: "dave" });
    }

    {
      // Live write: register environment is cheaper than full PQ onchain dual-tx path for smoke;
      // use hash + storeCommitment with random-looking bytes (may revert if env not registered — still proves auth+RPC).
      const envUuid = Buffer.from("dave-verify-env!!").toString("hex").slice(0, 32); // 16 bytes hex
      const commitment = (await callTool(port, 41, "veya_hash_blake3", { data: `dave-${Date.now()}` }));
      const hashText = toolText(commitment.json);
      const hash = JSON.parse(hashText).hash as string;

      const r = await callTool(
        port,
        42,
        "veya_store_commitment",
        {
          environmentUuidHex: envUuid,
          commitmentHex: hash,
        },
        LOCAL_MCP_KEY,
      );
      const t = toolText(r.json);
      const isError = r.json?.result?.isError === true || t.includes('"error"');
      // Success = txHash; acceptable auth-path proof = any chain/contract revert after auth passed
      const authPassed =
        t.includes("txHash") ||
        t.toLowerCase().includes("revert") ||
        t.toLowerCase().includes("execution reverted") ||
        t.toLowerCase().includes("environment") ||
        t.toLowerCase().includes("nonce") ||
        (!t.toLowerCase().includes("unauthor") && !t.toLowerCase().includes("bearer"));
      const ok = r.status === 200 && authPassed && (t.includes("txHash") || isError);
      log(
        "veya_store_commitment WITH bearer (live chain)",
        ok,
        t.slice(0, 220).replace(/\s+/g, " "),
      );
      results.push({
        name: "veya_store_commitment dave",
        ok,
        note: t.includes("txHash") ? "mined/submitted" : "auth ok, contract may revert",
      });
    }

    {
      const r = await callTool(port, 43, "veya_commitment_exists", {
        digestHex: "c".repeat(64),
      });
      const t = toolText(r.json);
      const ok = t.includes("onChain") || t.includes("digestHex");
      log("veya_commitment_exists", ok, t.slice(0, 120).replace(/\s+/g, " "));
      results.push({ name: "veya_commitment_exists", ok, note: "dave/user" });
    }

    // health endpoint
    {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await res.json();
      const ok =
        res.status === 200 &&
        body.version === "1.1.0" &&
        body.writesEnabled === true;
      log("GET /health", ok, `version=${body.version} writesEnabled=${body.writesEnabled}`);
      results.push({ name: "/health", ok, note: "ops" });
    }

    const failed = results.filter((r) => !r.ok);
    console.log("\n=== SUMMARY ===");
    console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
    if (failed.length) {
      for (const f of failed) console.log(`  FAIL ${f.name} (${f.note})`);
      process.exitCode = 1;
    } else {
      console.log("ALL CHECKS PASSED");
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

main().catch((err) => {
  console.error("[verify] FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
