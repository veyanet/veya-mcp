/**
 * Full local MCP verification:
 * - User (no key): paste-URL stranger
 * - Product tools: apiKey required
 * - Writes: unfunded payer → exact testnet-tokens sentence
 * - Optional: VEYA_TEST_API_KEY + VEYA_PAYER_PRIVATE_KEY for a live user-paid tx
 *
 * Does not print secrets.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { loadConfig, MCP_SERVICE_VERSION } from "../src/config.js";
import { createHttpApp } from "../src/http.js";
import { NO_TESTNET_TOKENS, MINT_API_KEY_HINT } from "../src/credentials.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadLocalEnv(): void {
  const envPath = resolve(__dirname, "../.env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (
      k === "VEYA_PAYER_PRIVATE_KEY" ||
      k === "VEYA_TEST_API_KEY" ||
      k === "VEYA_API_URL"
    ) {
      if (v && !process.env[k]) process.env[k] = v;
    }
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
): Promise<{ status: number; json: any; raw: string }> {
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

function log(label: string, ok: boolean, detail?: string) {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  loadLocalEnv();
  const cfg = loadConfig();
  const app = createHttpApp(cfg);
  const server = app.listen(0);
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  console.log(`[verify] local MCP on :${port} (secrets not printed)`);

  const results: Array<{ name: string; ok: boolean; note: string }> = [];

  try {
    const init = await mcpPost(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "veya-verify", version: "1.2.2" },
      },
    });
    assert.equal(init.status, 200, init.raw.slice(0, 300));
    log("initialize", true);

    const listed = await mcpPost(port, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const tools = (listed.json?.result?.tools as Array<{ name: string }>) ?? [];
    const names = tools.map((t) => t.name);
    console.log(`[verify] tools/list count=${names.length}`);
    const listOk =
      names.length >= 40 &&
      names.includes("veya_store_commitment") &&
      names.includes("veya_writes_status") &&
      names.includes("veya_account") &&
      names.includes("veya_guest_login");
    log("tools/list includes user-paid writes", listOk, `${names.length} tools`);
    results.push({ name: "tools/list", ok: listOk, note: `${names.length}` });

    console.log("\n=== USER (no key) ===");

    {
      const r = await callTool(port, 10, "veya_describe");
      const t = toolText(r.json);
      const ok = t.includes("1.2.2") && t.includes("46630");
      log("veya_describe", ok);
      results.push({ name: "veya_describe", ok, note: "user" });
    }

    {
      const r = await callTool(port, 11, "veya_ping_chain");
      const t = toolText(r.json);
      const ok = r.status === 200 && (t.includes("46630") || t.includes("chainId"));
      log("veya_ping_chain", ok);
      results.push({ name: "veya_ping_chain", ok, note: "user" });
    }

    {
      const r = await callTool(port, 12, "veya_list_environments", {});
      const t = toolText(r.json);
      const ok = t.includes("apiKey required") && r.json?.result?.isError === true;
      log("veya_list_environments without apiKey", ok);
      results.push({ name: "list without apiKey", ok, note: t.slice(0, 80).replace(/\s+/g, " ") });
    }

    {
      const r = await callTool(port, 13, "veya_list_environments", {
        apiKey: "veya_dev_00000000-0000-0000-0000-000000000000_invalid",
      });
      const t = toolText(r.json);
      const ok =
        r.json?.result?.isError === true &&
        (t.includes("401") ||
          t.includes("403") ||
          t.toLowerCase().includes("invalid") ||
          t.toLowerCase().includes("forbidden") ||
          t.toLowerCase().includes("rejected"));
      log("veya_list_environments invalid apiKey", ok);
      results.push({ name: "list invalid apiKey", ok, note: "rejected" });
    }

    {
      const guest = await callTool(port, 20, "veya_guest_login");
      const gt = toolText(guest.json);
      let token: string | undefined;
      try {
        const body = JSON.parse(gt);
        token = body?.body?.token || body?.token;
      } catch {
        /* ignore */
      }
      const guestOk = guest.status === 200 && gt.includes("httpStatus");
      log("veya_guest_login", guestOk, token ? "token received" : "see body");
      results.push({ name: "veya_guest_login", ok: guestOk, note: token ? "token" : "body" });

      if (token) {
        const create = await callTool(port, 22, "veya_create_environment", {
          apiKey: token,
          name: "should-refuse",
          type: "research",
        });
        const ct = toolText(create.json);
        const refused =
          create.json?.result?.isError === true &&
          (ct.includes(MINT_API_KEY_HINT) || ct.includes("Mint a product API key"));
        log("veya_create_environment guest JWT refused", refused);
        results.push({ name: "guest create refused", ok: refused, note: "mcp layer" });

        const anchor = await callTool(port, 23, "veya_anchor_proof", {
          apiKey: token,
          label: "nope",
          content: "nope",
        });
        const at = toolText(anchor.json);
        const anchorRefused =
          anchor.json?.result?.isError === true &&
          (at.includes("Mint a product API key") || at.includes("apiKey required"));
        log("veya_anchor_proof guest JWT refused", anchorRefused);
        results.push({ name: "guest anchor refused", ok: anchorRefused, note: "mcp layer" });
      }
    }

    console.log("\n=== UNFUNDED PAYER ===");
    {
      const empty = ethers.Wallet.createRandom();
      const r = await callTool(port, 30, "veya_store_commitment", {
        apiKey: "veya_dev_00000000-0000-0000-0000-000000000000_invalid",
        payerPrivateKey: empty.privateKey,
        environmentUuidHex: "0".repeat(32),
        commitmentHex: "a".repeat(64),
      });
      const t = toolText(r.json);
      const ok =
        t.includes(NO_TESTNET_TOKENS) ||
        t.toLowerCase().includes("invalid") ||
        t.toLowerCase().includes("rejected") ||
        t.includes("403") ||
        t.includes("401");
      log("store_commitment unfunded/invalid key fails closed", ok);
      results.push({ name: "unfunded or invalid write", ok, note: "closed" });
    }

    {
      const status = await callTool(port, 31, "veya_writes_status");
      const t = toolText(status.json);
      const ok = t.includes("userPaidWrites") && t.includes(NO_TESTNET_TOKENS);
      log("veya_writes_status", ok);
      results.push({ name: "veya_writes_status", ok, note: "user-paid" });
    }

    {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = (await res.json()) as Record<string, unknown>;
      const ok =
        res.status === 200 &&
        body.version === MCP_SERVICE_VERSION &&
        body.writesEnabled === true &&
        body.operatorRelayerWrites === false;
      log("GET /health", ok, `version=${body.version}`);
      results.push({ name: "/health", ok, note: "ops" });
    }

    const testKey = process.env.VEYA_TEST_API_KEY?.trim();
    const payer = process.env.VEYA_PAYER_PRIVATE_KEY?.trim();
    if (testKey && payer) {
      console.log("\n=== LIVE USER-PAID (env present, secrets not printed) ===");
      const list = await callTool(port, 40, "veya_list_environments", { apiKey: testKey });
      const lt = toolText(list.json);
      const listOk = list.status === 200 && (lt.includes("environments") || lt.includes("httpStatus"));
      log("list environments with product apiKey", listOk);
      results.push({ name: "live list apiKey", ok: listOk, note: "keyed" });

      const hash = await callTool(port, 41, "veya_hash_blake3", { data: `verify-${Date.now()}` });
      const hashText = toolText(hash.json);
      let digest = "";
      try {
        digest = JSON.parse(hashText).hash as string;
      } catch {
        digest = "";
      }
      const write = await callTool(port, 42, "veya_store_commitment", {
        apiKey: testKey,
        payerPrivateKey: payer,
        environmentUuidHex: "0".repeat(32),
        commitmentHex: digest || "b".repeat(64),
      });
      const wt = toolText(write.json);
      const funded =
        wt.includes("txHash") ||
        wt.includes(NO_TESTNET_TOKENS) ||
        wt.toLowerCase().includes("revert");
      const fromUser = !wt.toLowerCase().includes("relayer") && (wt.includes("from") || wt.includes(NO_TESTNET_TOKENS));
      log("live store_commitment user-paid", funded && fromUser);
      results.push({
        name: "live user-paid write",
        ok: funded && fromUser,
        note: wt.includes("txHash") ? "submitted" : "closed or tokens",
      });
    } else {
      console.log("[verify] skip live funded write (no VEYA_TEST_API_KEY + VEYA_PAYER_PRIVATE_KEY)");
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
