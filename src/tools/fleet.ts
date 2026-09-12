import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  runConsensus,
  protectedExec,
  requireVerifiedSeal,
  setToolPolicy,
  routeMessage,
  routeSecureMessage,
  verifySecureMessage,
  storeMemory,
  readMemory,
  invalidateMemory,
  pq,
} from "@veyanet/sdk";
import type { McpServiceConfig } from "../config.js";
import { createReadClient } from "../sdk.js";
import { toolError, toolJson } from "../api.js";

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
    "Run 2-of-3 BLAKE3 consensus. Fleet capacity is backend/product-API owned (api.veyanet.tech). Fail closed if unreachable — no invented quorum.",
    {
      taskId: z.string().min(1),
      payload: z.record(z.unknown()).default({}),
      nodeUrls: z.array(z.string().url()).optional(),
    },
    async ({ taskId, payload, nodeUrls }) => {
      try {
        const urls = nodeUrls?.length ? nodeUrls : cfg.validatorNodes;
        const result = await runConsensus(urls, taskId, payload);
        return toolJson(result);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_sealed_execute",
    "AES-256-GCM protected execution (not FHE). Sealed capacity is backend/product-API owned. Fail closed if unreachable.",
    {
      environmentId: z.string().min(1),
      agentId: z.string().min(1),
      eventType: z.string().min(1),
      payload: z.record(z.unknown()),
      sessionEntropyHex: z.string().min(16),
      sealedNodeUrl: z.string().url().optional(),
    },
    async (args) => {
      try {
        const url = args.sealedNodeUrl ?? cfg.sealedNodeUrl;
        const result = await protectedExec(url, {
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
    "Allow or deny a tool name for an agent in the in-process Boundnet policy map (SDK)",
    {
      agentId: z.string().min(1),
      tool: z.string().min(1),
      allowed: z.boolean(),
    },
    async ({ agentId, tool, allowed }) => {
      try {
        setToolPolicy(agentId, tool, allowed);
        return toolJson({ ok: true, agentId, tool, allowed });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_route_message",
    "Route an inter-agent message through deny-by-default tool policy",
    {
      id: z.string().min(1),
      fromAgent: z.string().min(1),
      toAgent: z.string().min(1),
      tool: z.string().min(1),
      payload: z.unknown(),
    },
    async (msg) => {
      try {
        return toolJson(routeMessage(msg));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_route_secure_message",
    "Policy route + Kyber-768 session + ML-DSA-44 signed envelope",
    {
      id: z.string().min(1),
      fromAgent: z.string().min(1),
      toAgent: z.string().min(1),
      tool: z.string().min(1),
      payload: z.unknown(),
      senderPrivateKeyHex: z.string().min(8),
      senderPublicKeyHex: z.string().min(8),
    },
    async (args) => {
      try {
        const routed = await routeSecureMessage(
          {
            id: args.id,
            fromAgent: args.fromAgent,
            toAgent: args.toAgent,
            tool: args.tool,
            payload: args.payload,
          },
          {
            senderPrivateKey: hexToBytes(args.senderPrivateKeyHex),
            senderPublicKey: hexToBytes(args.senderPublicKeyHex),
          },
        );
        return toolJson(routed);
      } catch (err) {
        return toolError(err);
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
    "Store local agent memory with BLAKE3 integrity (~/.veya). Not the product console guest proof list.",
    {
      environmentId: z.string().min(1),
      agentId: z.string().min(1),
      data: z.string().min(1),
    },
    async ({ environmentId, agentId, data }) => {
      try {
        return toolJson(await storeMemory(environmentId, agentId, data));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_read_memory",
    "Read local agent memory and re-check BLAKE3 integrity",
    {
      environmentId: z.string().min(1),
      id: z.string().min(1),
    },
    async ({ environmentId, id }) => {
      try {
        return toolJson(await readMemory(environmentId, id));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_invalidate_memory",
    "Nullify a local memory entry (spend-once semantics)",
    {
      environmentId: z.string().min(1),
      id: z.string().min(1),
    },
    async ({ environmentId, id }) => {
      try {
        invalidateMemory(environmentId, id);
        return toolJson({ nullified: true, environmentId, id });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_client_run_consensus",
    "Same as veya_run_consensus via VeyaClient defaults from this server config",
    {
      taskId: z.string().min(1),
      payload: z.record(z.unknown()).default({}),
    },
    async ({ taskId, payload }) => {
      try {
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
