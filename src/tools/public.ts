import { publicReplacer } from "../publicJson.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_SERVICE_NAME, MCP_SERVICE_VERSION, type McpServiceConfig } from "../config.js";
import { createReadClient } from "../sdk.js";
import { toolApiResult } from "../api.js";

export function registerPublicTools(server: McpServer, cfg: McpServiceConfig): void {
  server.tool(
    "veya_describe",
    "Service info: AES-256-GCM sealed execution and the selected settlement profile",
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
                network: cfg.network === "mainnet" ? "Robinhood Chain mainnet" : "Robinhood Chain testnet",
                contract: cfg.contractAddress,
                explorer: cfg.explorerUrl,
                rpc: cfg.rpcUrl,
              },
              productApi: cfg.apiUrl,
              sealed: "AES-256-GCM sealed-node",
              mainnet:
                cfg.network === "mainnet"
                  ? "Settlement is Robinhood Chain Mainnet. The protocol contract is 0x87dC582eEA544A434a5C1e30Ca3d12c1e548a674."
                  : "This process is on Testnet. Unset ROBINHOOD_NETWORK selects Mainnet and the protocol contract 0x87dC582eEA544A434a5C1e30Ca3d12c1e548a674.",
              writes:
                "On-chain writes need a product API key (veya_dev_ / veya_live_) and your funded wallet on the selected network.",
              toolSurface: "full (crypto, fleet, registry, product API, own-wallet writes)",
              fleet:
                "Consensus and sealed capacity are provided by the product API (api.veyanet.tech).",
              publicPasteUrl: "https://mcp.veyanet.tech/mcp",
            },
            publicReplacer,
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
                config: publicClientConfig(client.describe() as Record<string, unknown>),
              },
              publicReplacer,
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
    async ({ txHash }) => verifyTransactionTool(cfg, txHash),
  );

  server.tool(
    "veya_api_health",
    "Check the VEYA API /health status (api.veyanet.tech), including fleet status",
    {},
    async () => {
      const res = await fetch(`${cfg.apiUrl}/health`, {
        headers: { Accept: "application/json", "X-Veya-Network": cfg.network },
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.json().catch(() => ({}));
      return toolApiResult({ httpStatus: res.status, body });
    },
  );
}

export const NOT_VEYA_TX_MESSAGE =
  "This transaction is not a Veya receipt: it does not call Veya.sol on this network, or it was not found.";

/** Never returns a bare null: a non-Veya or unknown tx gives { ok:false, code:"NOT_VEYA_TX" }. */
export async function verifyTransactionTool(
  cfg: McpServiceConfig,
  txHash: string,
  verify: (hash: string) => Promise<unknown> = (hash) => createReadClient(cfg).verifyTransaction(hash),
) {
  const text = (v: unknown, isError = false) => ({
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text" as const, text: JSON.stringify(v, publicReplacer, 2) }],
  });
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash.trim())) {
    return text({ ok: false, code: "INVALID_TX_HASH", message: "txHash must be 0x followed by 64 hex characters." }, true);
  }
  let result: unknown;
  try {
    result = await verify(txHash.trim());
  } catch (err) {
    return text({ ok: false, code: "VERIFY_FAILED", message: err instanceof Error ? err.message : String(err) }, true);
  }
  if (result === null || result === undefined) {
    return text({ ok: false, code: "NOT_VEYA_TX", txHash: txHash.trim(), network: cfg.network, message: NOT_VEYA_TX_MESSAGE }, true);
  }
  return text(result);
}

/** Public tool output never includes internal fleet URLs; counts only. */
export function publicClientConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const { validatorNodes, sealedNodeUrl, ...rest } = raw;
  return {
    ...rest,
    validators: Array.isArray(validatorNodes) ? validatorNodes.length : 0,
    sealedNodeConfigured: Boolean(sealedNodeUrl),
  };
}
