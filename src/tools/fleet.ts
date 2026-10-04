import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  runConsensus,
  protectedExec,
  requireVerifiedSeal,
  establishKyberSession,
  verifySecureMessage,
  pq,
} from "@veyanet/sdk";
import type { McpServiceConfig } from "../config.js";
import { createReadClient } from "../sdk.js";
import { safeRequestMessage, toolError, toolJson } from "../api.js";
import { assertKeyRate } from "../limits.js";
import { readAccountForKey } from "../payer.js";
import { asTool, scopedApi, scopedKey } from "./scoped.js";

function hexToBytes(hex: string): Uint8Array {
  const h = hex.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]*$/.test(h) || h.length % 2 !== 0) {
    throw new Error("Expected even-length hex string");
  }
  return Uint8Array.from(Buffer.from(h, "hex"));
}

export function registerFleetTools(server: McpServer, cfg: McpServiceConfig): void {
  server.tool(
    "veya_run_consensus",
    "Run 2-of-3 BLAKE3 consensus on this server's validator list. Needs a product API key. Returns consensus_reached: false if validators are unreachable.",
    {
      apiKey: z.string().optional(),
      taskId: z.string().min(1),
      payload: z.record(z.unknown()).default({}),
    },
    async ({ apiKey, taskId, payload }) => {
      const key = scopedKey(apiKey);
      if (typeof key !== "string") return key.error;
      try {
        assertKeyRate(key);
        await readAccountForKey(cfg, key);
        const result = await runConsensus(cfg.validatorNodes, taskId, payload);
        return toolJson(result);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_sealed_execute",
    "AES-256-GCM protected execution on this server's sealed node. Needs a product API key. The call fails closed when that capacity is unreachable.",
    {
      apiKey: z.string().optional(),
      environmentId: z.string().min(1),
      agentId: z.string().min(1),
      eventType: z.string().min(1),
      payload: z.record(z.unknown()),
      sessionEntropyHex: z.string().min(16),
    },
    async (args) => {
      const key = scopedKey(args.apiKey);
      if (typeof key !== "string") return key.error;
      try {
        assertKeyRate(key);
        await readAccountForKey(cfg, key);
        const result = await protectedExec(cfg.sealedNodeUrl, {
          environmentId: args.environmentId,
          agentId: args.agentId,
          eventType: args.eventType,
          payload: args.payload,
          sessionEntropy: hexToBytes(args.sessionEntropyHex),
        });
        return toolJson(requireVerifiedSeal(result));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_set_tool_policy",
    "Allow or deny a tool for an agent. Requires the API key that owns the environment. Saved on that account.",
    {
      apiKey: z.string().optional(),
      environmentId: z.string().min(1),
      agentId: z.string().min(1),
      tool: z.string().min(1),
      allowed: z.boolean(),
    },
    async ({ apiKey, environmentId, agentId, tool, allowed }) => {
      const key = scopedKey(apiKey);
      if (typeof key !== "string") return key.error;
      const result = await scopedApi(
        cfg,
        key,
        `/v1/environments/${encodeURIComponent(environmentId)}/agents/${encodeURIComponent(agentId)}/tool-policy`,
        "POST",
        { tool, allowed },
      );
      return asTool(result);
    },
  );

  server.tool(
    "veya_route_message",
    "Check the saved tool rule for this API key before routing. Deny stays deny.",
    {
      apiKey: z.string().optional(),
      environmentId: z.string().min(1),
      id: z.string().min(1),
      fromAgent: z.string().min(1),
      toAgent: z.string().min(1),
      tool: z.string().min(1),
      payload: z.unknown(),
    },
    async (msg) => {
      const key = scopedKey(msg.apiKey);
      if (typeof key !== "string") return key.error;
      const result = await scopedApi(
        cfg,
        key,
        `/v1/environments/${encodeURIComponent(msg.environmentId)}/agents/${encodeURIComponent(msg.fromAgent)}/tool-check`,
        "POST",
        { tool: msg.tool },
      );
      return asTool(result);
    },
  );

  server.tool(
    "veya_route_secure_message",
    "Check the saved tool rule for this API key, then wrap an allowed message in a Kyber-768 session and an ML-DSA-44 signature.",
    {
      apiKey: z.string().optional(),
      environmentId: z.string().min(1),
      id: z.string().min(1),
      fromAgent: z.string().min(1),
      toAgent: z.string().min(1),
      tool: z.string().min(1),
      payload: z.unknown(),
      senderPrivateKeyHex: z.string().min(8),
      senderPublicKeyHex: z.string().min(8),
    },
    async (args) => {
      const key = scopedKey(args.apiKey);
      if (typeof key !== "string") return key.error;
      const checked = await scopedApi(
        cfg,
        key,
        `/v1/environments/${encodeURIComponent(args.environmentId)}/agents/${encodeURIComponent(args.fromAgent)}/tool-check`,
        "POST",
        { tool: args.tool },
      );
      if ("error" in checked) return checked.error;
      if (checked.httpStatus >= 400) return asTool(checked);
      const body = checked.body as { policyStatus?: string };
      if (body.policyStatus !== "allowed") {
        return toolJson({ policyStatus: "denied", id: args.id, tool: args.tool });
      }
      try {
        const session = await establishKyberSession(args.fromAgent, args.toAgent);
        const envelope = JSON.stringify({
          id: args.id,
          fromAgent: args.fromAgent,
          toAgent: args.toAgent,
          tool: args.tool,
          policyStatus: "allowed",
          kyberSessionId: session.sessionId,
        });
        const sig = await pq.signPQ(new TextEncoder().encode(envelope), hexToBytes(args.senderPrivateKeyHex));
        return toolJson({
          id: args.id,
          fromAgent: args.fromAgent,
          toAgent: args.toAgent,
          tool: args.tool,
          policyStatus: "allowed",
          kyberSessionId: session.sessionId,
          mlDsaSig: Buffer.from(sig).toString("hex"),
        });
      } catch (err) {
        return toolError(new Error(safeRequestMessage(err)));
      }
    },
  );

  server.tool(
    "veya_verify_secure_message",
    "Verify ML-DSA signature on a secure routed message envelope",
    {
      message: z.record(z.unknown()),
      senderPublicKeyHex: z.string().min(8),
    },
    async ({ message, senderPublicKeyHex }) => {
      try {
        const valid = await verifySecureMessage(
          message as Parameters<typeof verifySecureMessage>[0],
          hexToBytes(senderPublicKeyHex),
        );
        return toolJson({ valid });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_store_memory",
    "Store agent memory for the account behind this API key. No key, no write.",
    {
      apiKey: z.string().optional(),
      environmentId: z.string().min(1),
      agentId: z.string().min(1),
      data: z.string().min(1),
    },
    async ({ apiKey, environmentId, agentId, data }) => {
      const key = scopedKey(apiKey);
      if (typeof key !== "string") return key.error;
      const result = await scopedApi(
        cfg,
        key,
        `/v1/environments/${encodeURIComponent(environmentId)}/scoped-memory`,
        "POST",
        { agentId, data },
      );
      return asTool(result);
    },
  );

  server.tool(
    "veya_read_memory",
    "Read one memory row owned by this API key.",
    {
      apiKey: z.string().optional(),
      environmentId: z.string().min(1),
      id: z.string().min(1),
    },
    async ({ apiKey, environmentId, id }) => {
      const key = scopedKey(apiKey);
      if (typeof key !== "string") return key.error;
      const result = await scopedApi(
        cfg,
        key,
        `/v1/environments/${encodeURIComponent(environmentId)}/scoped-memory/${encodeURIComponent(id)}`,
        "GET",
      );
      return asTool(result);
    },
  );

  server.tool(
    "veya_invalidate_memory",
    "Nullify one memory row owned by this API key.",
    {
      apiKey: z.string().optional(),
      environmentId: z.string().min(1),
      id: z.string().min(1),
    },
    async ({ apiKey, environmentId, id }) => {
      const key = scopedKey(apiKey);
      if (typeof key !== "string") return key.error;
      const result = await scopedApi(
        cfg,
        key,
        `/v1/environments/${encodeURIComponent(environmentId)}/scoped-memory/${encodeURIComponent(id)}`,
        "DELETE",
      );
      return asTool(result);
    },
  );

  server.tool(
    "veya_client_run_consensus",
    "Deprecated: use veya_run_consensus. Same server validator list. Needs a product API key.",
    {
      apiKey: z.string().optional(),
      taskId: z.string().min(1),
      payload: z.record(z.unknown()).default({}),
    },
    async ({ apiKey, taskId, payload }) => {
      const key = scopedKey(apiKey);
      if (typeof key !== "string") return key.error;
      try {
        assertKeyRate(key);
        await readAccountForKey(cfg, key);
        const client = createReadClient(cfg);
        return toolJson(await client.runConsensus(taskId, payload));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_pq_fingerprint",
    "BLAKE3 fingerprint of an ML-DSA public key hex",
    { publicKeyHex: z.string().min(8) },
    async ({ publicKeyHex }) => {
      try {
        const hash = await pq.publicKeyHashBlake3(hexToBytes(publicKeyHex));
        return toolJson({ publicKeyHash: hash });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
