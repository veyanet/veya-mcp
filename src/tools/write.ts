import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServiceConfig } from "../config.js";
import { writesEnabled } from "../config.js";
import { assertWriteAuthorized } from "../auth.js";
import { createWriteClient, parseHexBytes } from "../sdk.js";

/**
 * Write tools are registered only when MCP_API_KEY + relayer key exist.
 * Callers must still pass Authorization: Bearer on the HTTP request;
 * bearer is read from request AsyncLocalStorage.
 */
export function registerWriteTools(
  server: McpServer,
  cfg: McpServiceConfig,
  getBearer: () => string | null,
): void {
  if (!writesEnabled(cfg)) {
    server.tool(
      "veya_writes_status",
      "Reports that on-chain write tools are disabled on this server",
      {},
      async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              writesEnabled: false,
              reason: "Set MCP_API_KEY and VEYA_RELAYER_PRIVATE_KEY to enable write tools",
            }),
          },
        ],
      }),
    );
    return;
  }

  function requireAuth(): void {
    assertWriteAuthorized(cfg, getBearer());
  }

  server.tool(
    "veya_store_commitment",
    "Write a 32-byte commitment to Veya.sol (requires MCP_API_KEY). Use content Use stamps prefer product-site + API.",
    {
      environmentUuidHex: z.string().min(32),
      commitmentHex: z.string().min(64),
    },
    async ({ environmentUuidHex, commitmentHex }) => {
      requireAuth();
      const client = createWriteClient(cfg);
      const txHash = await client.requireEvm().storeCommitment(
        parseHexBytes(environmentUuidHex, 16),
        parseHexBytes(commitmentHex, 32),
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ txHash, explorer: client.explorerFor(txHash) }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "veya_attest_execution",
    "attestExecution on Veya.sol with ML-DSA bytes (requires MCP_API_KEY)",
    {
      environmentUuidHex: z.string().min(32),
      blake3HashHex: z.string().min(64),
      mldsaSigHex: z.string().min(8),
    },
    async ({ environmentUuidHex, blake3HashHex, mldsaSigHex }) => {
      requireAuth();
      const client = createWriteClient(cfg);
      const txHash = await client.requireEvm().attestExecution(
        parseHexBytes(environmentUuidHex, 16),
        parseHexBytes(blake3HashHex, 32),
        parseHexBytes(mldsaSigHex),
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ txHash, explorer: client.explorerFor(txHash) }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "veya_register_environment",
    "registerEnvironment on Veya.sol (requires MCP_API_KEY)",
    {
      environmentUuidHex: z.string().min(32),
      pqPubkeyHashHex: z.string().min(64),
      envType: z.number().int().min(0).max(10).default(0),
    },
    async ({ environmentUuidHex, pqPubkeyHashHex, envType }) => {
      requireAuth();
      const client = createWriteClient(cfg);
      const txHash = await client.requireEvm().registerEnvironment(
        parseHexBytes(environmentUuidHex, 16),
        parseHexBytes(pqPubkeyHashHex, 32),
        envType,
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ txHash, explorer: client.explorerFor(txHash) }, null, 2),
          },
        ],
      };
    },
  );
}
