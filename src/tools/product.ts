import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServiceConfig } from "../config.js";
import { apiRequest, toolError, toolJson, toolApiResult } from "../api.js";
import { MINT_API_KEY_HINT, requireProductApiKey, resolveCredential } from "../credentials.js";
import { mapWriteError, prepareUserPayer } from "../payer.js";
import { createWriteClient, parseHexBytes } from "../sdk.js";

const apiKey = z
  .string()
  .min(10)
  .optional()
  .describe("Product API key (veya_dev_… / veya_live_…). Mint on the product site. Guest JWT is not a write credential.");

const sessionToken = z
  .string()
  .min(10)
  .optional()
  .describe("Optional guest JWT for Use listing only. Prefer apiKey.");

const payerPrivateKey = z
  .string()
  .min(10)
  .optional()
  .describe("User wallet private key that pays gas. Prefer VEYA_PAYER_PRIVATE_KEY on a self-hosted MCP.");

function missingKey() {
  return toolError(new Error("apiKey required"));
}

export function registerProductTools(server: McpServer, cfg: McpServiceConfig): void {
  server.tool(
    "veya_guest_login",
    "Create a guest session on the product API (Use listing only). Guest cannot mint API keys or write from MCP.",
    {},
    async () => {
      try {
        return toolApiResult(await apiRequest(cfg, "/auth/guest", { method: "POST" }));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_account",
    "Return the wallet bound to a product API key",
    { apiKey, sessionToken },
    async ({ apiKey: key, sessionToken: jwt }) => {
      try {
        const credential = resolveCredential(key, jwt);
        if (!credential) return missingKey();
        return toolApiResult(
          await apiRequest(cfg, "/v1/account", { apiKey: credential, sessionToken: credential }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_list_environments",
    "List environments for a product API key (guest JWT sees showcase / Use scope only)",
    { apiKey, sessionToken },
    async ({ apiKey: key, sessionToken: jwt }) => {
      try {
        const credential = resolveCredential(key, jwt);
        if (!credential) return missingKey();
        return toolApiResult(
          await apiRequest(cfg, "/v1/environments", { apiKey: credential, sessionToken: credential }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_get_environment",
    "Get one environment by id",
    { apiKey, sessionToken, environmentId: z.string().min(1) },
    async ({ apiKey: key, sessionToken: jwt, environmentId }) => {
      try {
        const credential = resolveCredential(key, jwt);
        if (!credential) return missingKey();
        return toolApiResult(
          await apiRequest(cfg, `/v1/environments/${encodeURIComponent(environmentId)}`, {
            apiKey: credential,
            sessionToken: credential,
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_create_environment",
    "Create environment in the product API (Build). Does not spend gas. Guests and non-keys are refused.",
    {
      apiKey,
      sessionToken,
      name: z.string().min(1),
      type: z.enum(["research", "governance", "treasury", "contributor", "protocol", "desci"]),
    },
    async ({ apiKey: key, sessionToken: jwt, name, type }) => {
      try {
        const productKey = requireProductApiKey(key, jwt);
        return toolApiResult(
          await apiRequest(cfg, "/v1/environments", {
            method: "POST",
            apiKey: productKey,
            body: { name, type },
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_list_agents",
    "List agents in an environment",
    { apiKey, sessionToken, environmentId: z.string().min(1) },
    async ({ apiKey: key, sessionToken: jwt, environmentId }) => {
      try {
        const credential = resolveCredential(key, jwt);
        if (!credential) return missingKey();
        return toolApiResult(
          await apiRequest(cfg, `/v1/environments/${encodeURIComponent(environmentId)}/agents`, {
            apiKey: credential,
            sessionToken: credential,
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_deploy_agent",
    "Deploy an agent (Build). Product API key required. Guests receive 403 by design.",
    {
      apiKey,
      sessionToken,
      environmentId: z.string().min(1),
      type: z.string().min(1),
      agentKind: z.string().min(3).max(64).optional(),
      permissionConfig: z.record(z.unknown()).optional(),
    },
    async ({ apiKey: key, sessionToken: jwt, environmentId, type, agentKind, permissionConfig }) => {
      try {
        const productKey = requireProductApiKey(key, jwt);
        return toolApiResult(
          await apiRequest(cfg, `/v1/environments/${encodeURIComponent(environmentId)}/agents`, {
            method: "POST",
            apiKey: productKey,
            body: { type, agentKind: agentKind ?? type, permissionConfig },
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_list_api_memory",
    "List memory entries via product API for an environment",
    {
      apiKey,
      sessionToken,
      environmentId: z.string().min(1),
      scope: z.enum(["environment", "agent", "session"]).optional(),
    },
    async ({ apiKey: key, sessionToken: jwt, environmentId, scope }) => {
      try {
        const credential = resolveCredential(key, jwt);
        if (!credential) return missingKey();
        const q = scope ? `?scope=${scope}` : "";
        return toolApiResult(
          await apiRequest(
            cfg,
            `/v1/environments/${encodeURIComponent(environmentId)}/memory${q}`,
            { apiKey: credential, sessionToken: credential },
          ),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_list_executions",
    "List executions for an environment via product API",
    { apiKey, sessionToken, environmentId: z.string().min(1) },
    async ({ apiKey: key, sessionToken: jwt, environmentId }) => {
      try {
        const credential = resolveCredential(key, jwt);
        if (!credential) return missingKey();
        return toolApiResult(
          await apiRequest(
            cfg,
            `/v1/environments/${encodeURIComponent(environmentId)}/executions`,
            { apiKey: credential, sessionToken: credential },
          ),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_run_protected_execution",
    "Run protected execution via product API (Build). Product API key required.",
    {
      apiKey,
      sessionToken,
      environmentId: z.string().min(1),
      agentId: z.string().min(1),
      eventType: z.string().min(1),
      payload: z.record(z.unknown()),
      disclose: z.array(z.string()).optional(),
      seal: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        const productKey = requireProductApiKey(args.apiKey, args.sessionToken);
        return toolApiResult(
          await apiRequest(
            cfg,
            `/v1/environments/${encodeURIComponent(args.environmentId)}/executions/protected`,
            {
              method: "POST",
              apiKey: productKey,
              body: {
                agentId: args.agentId,
                eventType: args.eventType,
                payload: args.payload,
                disclose: args.disclose,
                seal: args.seal,
              },
            },
          ),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_boundnet_invoke",
    "Invoke a Boundnet / coordination tool via product API (policy gated)",
    {
      apiKey,
      sessionToken,
      environmentId: z.string().min(1),
      agentId: z.string().min(1),
      toolName: z.string().min(1),
      arguments: z.record(z.unknown()).optional(),
    },
    async (args) => {
      try {
        const productKey = requireProductApiKey(args.apiKey, args.sessionToken);
        return toolApiResult(
          await apiRequest(
            cfg,
            `/v1/environments/${encodeURIComponent(args.environmentId)}/boundnet/invoke`,
            {
              method: "POST",
              apiKey: productKey,
              body: {
                agentId: args.agentId,
                toolName: args.toolName,
                arguments: args.arguments,
              },
            },
          ),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_list_proofs",
    "List Use-mode proof anchors for the account",
    { apiKey, sessionToken },
    async ({ apiKey: key, sessionToken: jwt }) => {
      try {
        const credential = resolveCredential(key, jwt);
        if (!credential) return missingKey();
        return toolApiResult(
          await apiRequest(cfg, "/v1/proofs", { apiKey: credential, sessionToken: credential }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_anchor_proof",
    "Anchor a content proof on Veya.sol from YOUR wallet (apiKey + payerPrivateKey). Does not use the hosted relayer.",
    {
      apiKey,
      sessionToken,
      payerPrivateKey,
      label: z.string().min(1),
      content: z.string().min(1),
      environmentId: z.string().min(1).optional(),
    },
    async ({ apiKey: key, sessionToken: jwt, payerPrivateKey: payer, label, content, environmentId }) => {
      try {
        const productKey = requireProductApiKey(key, jwt);
        const prepared = await prepareUserPayer(cfg, productKey, payer);
        const client = createWriteClient(cfg, prepared.privateKey);
        const hash = await client.hashBlake3(`${label}\n${content}`);

        let environmentUuidHex = "0".repeat(32);
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
          environmentUuidHex = body.registration.environmentUuid;
        }

        const txHash = await client.requireEvm().storeCommitment(
          parseHexBytes(environmentUuidHex, 16),
          parseHexBytes(hash, 32),
        );
        return toolJson({
          txHash,
          explorer: client.explorerFor(txHash),
          from: prepared.address,
          hash,
          label,
        });
      } catch (err) {
        if (err instanceof Error && err.message === "apiKey required") {
          return missingKey();
        }
        if (err instanceof Error && err.message === MINT_API_KEY_HINT) {
          return toolError(err);
        }
        return toolError(mapWriteError(err));
      }
    },
  );

  server.tool(
    "veya_verify_proof_api",
    "Verify an anchored proof via product API public verify path",
    { signature: z.string().min(1) },
    async ({ signature }) => {
      try {
        return toolApiResult(
          await apiRequest(cfg, `/api/verify/${encodeURIComponent(signature)}`),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
