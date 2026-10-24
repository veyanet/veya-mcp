/**
 * Agent-facing surface. Exactly three tools:
 *  - veya_paid_discover  (read-only; unpaid 402 quote + policy preview; cannot pay)
 *  - veya_paid_call      (one paid call, only through the VEYA policy gate)
 *  - veya_paid_run       (read run status / resume verification and anchoring; never pays)
 * No key, no wallet, no transfer/swap/trade/do() tool is ever registered.
 */
import { z } from "zod";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadPaidConfig, payerKind, PAID_ROOT, type PaidConfig } from "./config.js";
import { PaidCallGuard } from "./pipeline.js";
import { createCaller } from "./payer.js";
import { createAnchorer } from "./anchor.js";
import { evaluatePolicy, probeChallenge } from "./policy.js";

export const PAID_TOOL_NAMES = ["veya_paid_discover", "veya_paid_call", "veya_paid_run"] as const;

export function buildGuardFromEnv(cfg: PaidConfig = loadPaidConfig()): PaidCallGuard {
  const keyPath = process.env.VEYA_PAID_SOLANA_KEY_PATH;
  // Separate env from the MCP relayer so no other MCP tool gains write power.
  const anchorKeyPath = process.env.VEYA_PAID_ANCHOR_KEY_PATH;
  return new PaidCallGuard({
    cfg, stateDir: process.env.VEYA_PAID_STATE_DIR || join(PAID_ROOT, "state"), receiptsDir: process.env.VEYA_PAID_RECEIPTS_DIR || join(PAID_ROOT, "receipts"),
    caller: () => { if (!keyPath) throw new Error("PAYER_NOT_CONFIGURED: VEYA_PAID_SOLANA_KEY_PATH unset"); return createCaller(cfg, keyPath); },
    anchorer: () => { if (!anchorKeyPath) throw new Error("ANCHOR_NOT_CONFIGURED"); return createAnchorer(cfg, readFileSync(anchorKeyPath, "utf8").trim()); },
  });
}

/**
 * One guard (and so one in-memory ledger) per process. The HTTP transport builds a new McpServer per
 * request; sharing the guard keeps budget reservation and idempotency atomic across parallel requests.
 */
let shared: { guard: PaidCallGuard; cfg: PaidConfig } | undefined;
export function sharedGuard(): { guard: PaidCallGuard; cfg: PaidConfig } {
  if (!shared) { const cfg = loadPaidConfig(); shared = { guard: buildGuardFromEnv(cfg), cfg }; }
  return shared;
}

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }] });

export function registerPaidCallTools(server: McpServer, guard: PaidCallGuard = sharedGuard().guard, cfg: PaidConfig = sharedGuard().cfg): void {
  server.tool("veya_paid_discover", "Read-only. List the paid resources this VEYA policy allows, with their input fields, a live unpaid price quote and a policy preview. Cannot pay.",
    {},
    async () => {
      const out = [];
      for (const r of cfg.resources) {
        try {
          const quote = await probeChallenge(r.url, {});
          const g = evaluatePolicy(cfg, { tool: "veya_paid_call", resourceUrl: r.url, resourceId: r.id, quote, taskBudgetAtomic: BigInt(cfg.policy.taskBudgetAtomic) });
          out.push({ id: r.id, provider: r.provider, payer: payerKind(cfg, r), description: r.description, input: r.input, quote, policyPreview: g.allow ? { allow: true, callCostAtomic: g.callCostAtomic.toString() } : { allow: false, code: g.code, reason: g.reason } });
        } catch (e) { out.push({ id: r.id, error: (e as Error).message }); }
      }
      return json({ disabled: guard.disabled(), resources: out });
    });

  server.tool("veya_paid_call", "Run one paid x402 resource call through the VEYA policy gate. VEYA checks tool, host, resource, network, asset, payee, price cap, task budget and input BEFORE any payment, then verifies the Solana payment and the result, runs a 2-of-3 validator check and anchors a commitment on Robinhood Chain.",
    {
      taskId: z.string().min(1).max(80), idempotencyKey: z.string().min(8).max(120),
      resourceId: z.string().optional(), input: z.record(z.string()),
      taskBudgetAtomic: z.string().regex(/^\d+$/).optional(), url: z.string().optional(),
    },
    async ({ taskId, idempotencyKey, resourceId, input, taskBudgetAtomic, url }) =>
      json(await guard.call({ taskId, idempotencyKey, input, taskBudgetAtomic, resourceId, url })));

  server.tool("veya_paid_run", "Read a VEYA paid-call run (state, evidence links). With resume=true, retries Solana verification or VEYA anchoring for a pending run, or looks for an on-chain payment after a resource error. Never pays.",
    { runId: z.string(), resume: z.boolean().optional() },
    async ({ runId, resume }) => {
      if (resume) { const r = guard.ledger.run(runId); return json(r?.state === "resource_error" ? await guard.reconcile(runId) : await guard.resume(runId)); }
      const r = guard.ledger.run(runId); return json(r ? guard.view(r) : { error: "unknown run" });
    });
}
