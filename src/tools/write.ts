import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServiceConfig } from "../config.js";
import { apiRequest, toolError, toolJson, toolApiResult, type ApiResult } from "../api.js";
import { requireProductApiKey, ROBINHOOD_TESTNET_FAUCET_URL } from "../credentials.js";
import { mapWriteError, prepareUserPayer } from "../payer.js";
import { createWriteClient, parseHexBytes } from "../sdk.js";

async function confirmEnvironmentRegistration(
  cfg: McpServiceConfig,
  productKey: string,
  environmentId: string,
  txHash: string,
): Promise<ApiResult> {
  let last: ApiResult | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    last = await apiRequest(
      cfg,
      `/v1/chain/environments/${encodeURIComponent(environmentId)}/confirm-registration`,
      {
        method: "POST",
        apiKey: productKey,
        body: { transactionHash: txHash },
      },
    );
    if (last.httpStatus < 400) return last;
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return last!;
}

const apiKey = z
  .string()
  .min(10)
  .optional()
  .describe("Product API key (veya_dev_… / veya_live_…). Required for on-chain writes.");

const payerPrivateKey = z
  .string()
  .min(10)
  .optional()
  .describe("User wallet private key that pays gas. Prefer VEYA_PAYER_PRIVATE_KEY on a self-hosted MCP.");

/**
 * User-paid write tools. msg.sender is the user's wallet.
 * The hosted relayer is never used on this path.
 */
export function registerWriteTools(server: McpServer, cfg: McpServiceConfig): void {
  server.tool(
    "veya_writes_status",
    "Reports how on-chain writes work on this server (user-paid vs operator relayer)",
    {},
    async () =>
      toolJson({
        userPaidWrites: true,
        operatorRelayerWrites: false,
        requires: {
          apiKey: "veya_dev_ or veya_live_ from the product site",
          payerPrivateKey: "your wallet; set VEYA_PAYER_PRIVATE_KEY or pass the tool argument",
        },
        gasPayer: "The transaction is sent from the user's wallet, not the hosted relayer",
        emptyWallet: "You don't have testnet tokens. Please get them for the transaction.",
        faucetUrl: ROBINHOOD_TESTNET_FAUCET_URL,
      }),
  );

  async function withUserPayer<T>(
    key: string | undefined,
    payer: string | undefined,
    fn: (client: ReturnType<typeof createWriteClient>, address: string) => Promise<T>,
  ) {
    const productKey = requireProductApiKey(key);
    const prepared = await prepareUserPayer(cfg, productKey, payer);
    const client = createWriteClient(cfg, prepared.privateKey);
    return { result: await fn(client, prepared.address), from: prepared.address, client };
  }

  server.tool(
    "veya_store_commitment",
    "Write a 32-byte commitment to Veya.sol from YOUR wallet (apiKey + payerPrivateKey)",
    {
      apiKey,
      payerPrivateKey,
      environmentUuidHex: z.string().min(32),
      commitmentHex: z.string().min(64),
    },
    async ({ apiKey: key, payerPrivateKey: payer, environmentUuidHex, commitmentHex }) => {
      try {
        const { result: txHash, from, client } = await withUserPayer(key, payer, async (c) =>
          c.requireEvm().storeCommitment(
            parseHexBytes(environmentUuidHex, 16),
            parseHexBytes(commitmentHex, 32),
          ),
        );
        return toolJson({ txHash, explorer: client.explorerFor(txHash), from });
      } catch (err) {
        return toolError(mapWriteError(err));
      }
    },
  );

  server.tool(
    "veya_attest_execution",
    "attestExecution on Veya.sol from YOUR wallet with ML-DSA bytes",
    {
      apiKey,
      payerPrivateKey,
      environmentUuidHex: z.string().min(32),
      blake3HashHex: z.string().min(64),
      mldsaSigHex: z.string().min(8),
    },
    async ({ apiKey: key, payerPrivateKey: payer, environmentUuidHex, blake3HashHex, mldsaSigHex }) => {
      try {
        const { result: txHash, from, client } = await withUserPayer(key, payer, async (c) =>
          c.requireEvm().attestExecution(
            parseHexBytes(environmentUuidHex, 16),
            parseHexBytes(blake3HashHex, 32),
            parseHexBytes(mldsaSigHex),
          ),
        );
        return toolJson({ txHash, explorer: client.explorerFor(txHash), from });
      } catch (err) {
        return toolError(mapWriteError(err));
      }
    },
  );

  server.tool(
    "veya_register_environment",
    "registerEnvironment on Veya.sol from YOUR wallet. Pass product environmentId to confirm the tx on the product API.",
    {
      apiKey,
      payerPrivateKey,
      environmentUuidHex: z.string().min(32).optional(),
      environmentId: z.string().min(1).optional(),
      pqPubkeyHashHex: z.string().min(64).optional(),
      envType: z.number().int().min(0).max(10).default(0),
    },
    async ({
      apiKey: key,
      payerPrivateKey: payer,
      environmentUuidHex,
      environmentId,
      pqPubkeyHashHex,
      envType,
    }) => {
      try {
        const productKey = requireProductApiKey(key);
        let uuidHex = environmentUuidHex;
        if (environmentId) {
          const plan = await apiRequest(
            cfg,
            `/v1/chain/environments/${encodeURIComponent(environmentId)}/registration`,
            { apiKey: productKey },
          );
          const body = plan.body as { registration?: { environmentUuid?: string } };
          if (plan.httpStatus >= 400 || !body.registration?.environmentUuid) {
            return toolApiResult(plan);
          }
          uuidHex = body.registration.environmentUuid;
        }
        if (!uuidHex) {
          throw new Error("environmentId or environmentUuidHex required");
        }
        const pqHash = pqPubkeyHashHex ?? "0".repeat(64);
        const { result: txHash, from, client } = await withUserPayer(key, payer, async (c) =>
          c.requireEvm().registerEnvironment(
            parseHexBytes(uuidHex, 16),
            parseHexBytes(pqHash, 32),
            envType,
          ),
        );

        let confirmed: unknown = null;
        if (environmentId) {
          confirmed = await confirmEnvironmentRegistration(cfg, productKey, environmentId, txHash);
        }

        const confirmResult = confirmed as ApiResult | null;
        const confirmFailed =
          Boolean(environmentId) &&
          (confirmResult == null || confirmResult.httpStatus >= 400);

        return toolJson({
          txHash,
          explorer: client.explorerFor(txHash),
          from,
          environmentUuidHex: uuidHex,
          consoleSynced: environmentId ? !confirmFailed : undefined,
          confirmed,
          warning: confirmFailed
            ? "On-chain register succeeded; product console confirm failed after retries. Do not retry this write — check the explorer from field."
            : undefined,
        });
      } catch (err) {
        return toolError(mapWriteError(err));
      }
    },
  );

  server.tool(
    "veya_register_pq_onchain",
    "Generate ML-DSA identity and register environment + commitment on Veya.sol from YOUR wallet",
    {
      apiKey,
      payerPrivateKey,
      envType: z.number().int().min(0).max(10).default(1),
    },
    async ({ apiKey: key, payerPrivateKey: payer, envType }) => {
      try {
        const { result, from, client } = await withUserPayer(key, payer, async (c) =>
          c.registerPqOnchain(envType),
        );
        return toolJson({
          publicKeyHex: Buffer.from(result.publicKey).toString("hex"),
          publicKeyHash: result.publicKeyHash,
          environmentTx: result.environmentTx,
          memoTx: result.memoTx,
          explorer: result.explorer,
          from,
          explorerEnv: client.explorerFor(result.environmentTx),
        });
      } catch (err) {
        return toolError(mapWriteError(err));
      }
    },
  );

  server.tool(
    "veya_anchor_pq_attestation",
    "Link PQ identity hash to execution hash on Veya.sol from YOUR wallet",
    {
      apiKey,
      payerPrivateKey,
      environmentUuidHex: z.string().min(32),
      identityHashHex: z.string().min(64),
      executionHashHex: z.string().min(64),
    },
    async ({
      apiKey: key,
      payerPrivateKey: payer,
      environmentUuidHex,
      identityHashHex,
      executionHashHex,
    }) => {
      try {
        const { result: txHash, from, client } = await withUserPayer(key, payer, async (c) =>
          c.requireEvm().anchorPqAttestation(
            parseHexBytes(environmentUuidHex, 16),
            parseHexBytes(identityHashHex, 32),
            parseHexBytes(executionHashHex, 32),
          ),
        );
        return toolJson({ txHash, explorer: client.explorerFor(txHash), from });
      } catch (err) {
        return toolError(mapWriteError(err));
      }
    },
  );
}
