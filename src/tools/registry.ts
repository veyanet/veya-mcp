import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServiceConfig } from "../config.js";
import { apiRequest, toolError, toolJson, toolApiResult } from "../api.js";
import { createReadClient, parseHexBytes } from "../sdk.js";

export function registerRegistryTools(server: McpServer, cfg: McpServiceConfig): void {
  server.tool(
    "veya_public_stats",
    "Public registry stats from the product API (verified agents / proofs)",
    {},
    async () => {
      try {
        return toolApiResult(await apiRequest(cfg, "/public/stats"));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_public_list_agents",
    "List public agent registry rows",
    {
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async ({ limit, offset }) => {
      try {
        const q = new URLSearchParams();
        if (limit !== undefined) q.set("limit", String(limit));
        if (offset !== undefined) q.set("offset", String(offset));
        const suffix = q.toString() ? `?${q}` : "";
        return toolApiResult(await apiRequest(cfg, `/public/agents${suffix}`));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_public_get_agent",
    "Fetch one public agent by id",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return toolApiResult(await apiRequest(cfg, `/public/agents/${encodeURIComponent(id)}`));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_public_list_certificates",
    "List public certificate / attestation rows",
    {
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async ({ limit, offset }) => {
      try {
        const q = new URLSearchParams();
        if (limit !== undefined) q.set("limit", String(limit));
        if (offset !== undefined) q.set("offset", String(offset));
        const suffix = q.toString() ? `?${q}` : "";
        return toolApiResult(await apiRequest(cfg, `/public/certificates${suffix}`));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_public_get_certificate",
    "Fetch one public certificate by id",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return toolApiResult(await apiRequest(cfg, `/public/certificates/${encodeURIComponent(id)}`));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_public_get_execution",
    "Fetch a public execution proof by id",
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        return toolApiResult(await apiRequest(cfg, `/public/executions/${encodeURIComponent(id)}`));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_verify_commitment_onchain",
    "Parse Veya.sol events from a tx and eth_call commitments(digest) for each CommitmentStored",
    { txHash: z.string().min(66) },
    async ({ txHash }) => {
      try {
        const client = createReadClient(cfg);
        return toolJson(await client.verifyCommitmentOnChain(txHash));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_commitment_exists",
    "eth_call Veya.sol commitments(bytes32) for a digest",
    { digestHex: z.string().min(64) },
    async ({ digestHex }) => {
      try {
        const client = createReadClient(cfg);
        return toolJson({
          digestHex,
          onChain: await client.commitmentExists(digestHex),
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_read_environment_onchain",
    "Read environment record from Veya.sol by 16-byte UUID hex",
    { environmentUuidHex: z.string().min(32) },
    async ({ environmentUuidHex }) => {
      try {
        const client = createReadClient(cfg);
        const row = await client.readEnvironment(parseHexBytes(environmentUuidHex, 16));
        return toolJson({ environmentUuidHex, row });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_read_agent_onchain",
    "Read agent record from Veya.sol by 16-byte UUID hex",
    { agentUuidHex: z.string().min(32) },
    async ({ agentUuidHex }) => {
      try {
        const client = createReadClient(cfg);
        const row = await client.readAgent(parseHexBytes(agentUuidHex, 16));
        return toolJson({ agentUuidHex, row });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
