import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_SERVICE_NAME, MCP_SERVICE_VERSION, type McpServiceConfig } from "../config.js";
import { createReadClient } from "../sdk.js";

export function registerPublicTools(server: McpServer, cfg: McpServiceConfig): void {
  server.tool(
    "veya_describe",
    "Honesty card: what this MCP is (AES sealed elsewhere, testnet 46630, not FHE/mainnet)",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              name: MCP_SERVICE_NAME,
              version: MCP_SERVICE_VERSION,
              publicUrl: cfg.publicMcpUrl,
              settlement: {
                network: "Robinhood Chain testnet",
                chainId: cfg.chainId,
                contract: cfg.contractAddress,
                explorer: cfg.explorerUrl,
                rpc: cfg.rpcUrl,
              },
              productApi: cfg.apiUrl,
              sealed: "AES-256-GCM sealed-node (not FHE; TFHE is Phase 4)",
              mainnet: "Not a VEYA settlement claim (Phase 3)",
              writes: "Require Authorization: Bearer <MCP_API_KEY> when enabled on the server",
              stdioSibling: "Local stdio MCP remains at veya-anchor/packages/mcp (operators)",
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.tool(
    "veya_ping_chain",
    "Ping Robinhood Chain RPC — chain id, block, contract",
    {},
    async () => {
      const client = createReadClient(cfg);
      const ping = await client.pingChain();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...ping,
                chainId: ping.chainId.toString(),
                expectedChainId: cfg.chainId,
                config: client.describe(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "veya_hash_blake3",
    "Compute BLAKE3 hex digest (commitment helper)",
    { data: z.string().min(1) },
    async ({ data }) => {
      const client = createReadClient(cfg);
      const hash = await client.hashBlake3(data);
      return {
        content: [{ type: "text", text: JSON.stringify({ hash }, null, 2) }],
      };
    },
  );

  server.tool(
    "veya_verify_transaction",
    "Verify a Veya.sol commitment from a Robinhood Chain tx hash",
    { txHash: z.string().min(66) },
    async ({ txHash }) => {
      const client = createReadClient(cfg);
      const result = await client.verifyTransaction(txHash);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "veya_api_health",
    "Probe the public VEYA API /health (api.veyanet.tech) — honest degraded when fleet down",
    {},
    async () => {
      const res = await fetch(`${cfg.apiUrl}/health`, {
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.json().catch(() => ({}));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ httpStatus: res.status, body }, null, 2),
          },
        ],
      };
    },
  );
}
