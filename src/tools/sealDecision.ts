import { publicReplacer } from "../publicJson.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sealDecision, type SealDecisionResult } from "@veyanet/sdk";
import type { McpServiceConfig } from "../config.js";
import { sealDecisionRelayerEnabled } from "../config.js";
import { assertKeyRate, assertRelayerDaily, recordRelayerSeal } from "../limits.js";
import { prepareUserPayer, readAccountForKey } from "../payer.js";
import { scopedKey } from "./scoped.js";
const TESTNET_SEAL_ENVIRONMENT_ID = "7d0af0ba-2ae3-4d0e-bc75-0bbaccb3dd71";

/** Mainnet needs an explicit environment. Testnet can use the SDK default. Nothing is sent from here. */
export function resolveMcpSealEnvironment(
  network: "testnet" | "mainnet",
  argument: string | undefined,
  hostEnvironmentId: string | null,
): string | null {
  const chosen = argument?.trim() || hostEnvironmentId?.trim() || "";
  if (chosen) return chosen;
  if (network === "testnet") return TESTNET_SEAL_ENVIRONMENT_ID;
  return null;
}

/**
 * One sealed decision. The receipt is written only when this call passes
 * payerPrivateKey, or when VEYA_SEAL_DECISION_RELAYER is on and the host
 * relayer key is configured. The switch does not enable other write tools.
 */
export function registerSealDecisionTools(server: McpServer, cfg: McpServiceConfig): void {
  server.tool(
    "veya_seal_decision",
    "Seal an evidence id and a decision. attestExecution is sent only when a payer key is passed, or when this host's seal-decision relayer switch is on. On Mainnet pass environmentId or set VEYA_SEAL_DECISION_ENVIRONMENT_ID. Without either, the result is SEAL_ENVIRONMENT_REQUIRED and nothing is sent.",
    {
      evidenceId: z.string().min(1),
      decision: z.string().min(2),
      environmentId: z.string().optional(),
      apiKey: z.string().optional(),
      payerPrivateKey: z.string().optional(),
    },
    async ({ evidenceId, decision, environmentId, apiKey, payerPrivateKey }) => {
      const sealEnvironmentId = resolveMcpSealEnvironment(
        cfg.network,
        environmentId,
        cfg.sealDecisionEnvironmentId,
      );
      if (!sealEnvironmentId) {
        return refused("SEAL_ENVIRONMENT_REQUIRED");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(decision);
      } catch {
        return refused("decision must be a JSON object.");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return refused("decision must be a JSON object.");
      }
      if (cfg.network === "mainnet" && !cfg.contractAddress) {
        return refused(
          "MAINNET_UNPUBLISHED: Veya.sol is not published on Robinhood Chain mainnet. Nothing was sent.",
        );
      }
      const key = scopedKey(apiKey);
      if (typeof key !== "string") return key.error;
      let payer: string | undefined;
      let useRelayer = false;
      try {
        assertKeyRate(key);
        await readAccountForKey(cfg, key);
        if (payerPrivateKey?.trim()) {
          const prepared = await prepareUserPayer(cfg, key, payerPrivateKey);
          payer = prepared.privateKey;
        } else if (sealDecisionRelayerEnabled(cfg)) {
          assertRelayerDaily(key);
          useRelayer = true;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return refused(message);
      }
      try {
        const proof = await sealDecision(
          { evidenceId, decision: parsed as Record<string, unknown> },
          {
            payerPrivateKey: payer,
            operatorRelayer: useRelayer,
            relayerPrivateKey: useRelayer ? cfg.relayerPrivateKey ?? undefined : undefined,
            rpcUrl: cfg.rpcUrl,
            contractAddress: cfg.contractAddress,
            chainId: cfg.chainId,
            explorerUrl: cfg.explorerUrl,
            validatorUrls: cfg.validatorNodes,
            sealedNodeUrl: cfg.sealedNodeUrl,
            network: cfg.network,
            environmentId: sealEnvironmentId,
          },
        );
        if (useRelayer && proof.ok) recordRelayerSeal(key);
        return toolResult(proof);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return refused(message);
      }
    },
  );
}

/** sealed.transaction mirrors chain.txHash when a receipt was written, so both fields agree. */
export function normalizeSealProof(proof: SealDecisionResult): SealDecisionResult {
  if (!proof.ok || !proof.chain?.txHash) return proof;
  return {
    ...proof,
    sealed: { ...proof.sealed, transaction: proof.chain.txHash as unknown as null },
  };
}

function toolResult(raw: SealDecisionResult) {
  const proof = normalizeSealProof(raw);
  return {
    isError: !proof.ok,
    content: [{ type: "text" as const, text: JSON.stringify(proof, publicReplacer, 2) }],
  };
}

function refused(refusal: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: false,
            transaction: null,
            continuedOnOpenWorker: false,
            refusal,
          },
          null,
          2,
        ),
      },
    ],
  };
}
