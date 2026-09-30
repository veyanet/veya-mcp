import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VeyaClient, type ProveSource } from "@veyanet/sdk";
import type { McpServiceConfig } from "../config.js";

/**
 * One proof entry. Without anchor, a digest is returned and nothing is sent.
 * Anchor sends a transaction only when payerPrivateKey and environmentId are passed.
 */
export function registerProofTools(server: McpServer, cfg: McpServiceConfig): void {
  server.tool(
    "veya_prove",
    "Prove text, canonical JSON, or a receipt hash. Anchor writes only when a payer key is passed.",
    {
      text: z.string().optional(),
      json: z.string().optional(),
      txHash: z.string().optional(),
      anchor: z.boolean().optional(),
      environmentId: z.string().optional(),
      payerPrivateKey: z.string().optional(),
    },
    async ({ text, json, txHash, anchor, environmentId, payerPrivateKey }) => {
      const chosen = [text, json, txHash].filter((value) => value !== undefined && value !== "");
      if (chosen.length !== 1) {
        return refused("Pass exactly one of text, json, or txHash.");
      }
      let source: ProveSource;
      if (text) {
        source = { kind: "text", text };
      } else if (json) {
        try {
          source = { kind: "json", value: JSON.parse(json) };
        } catch {
          return refused("json must be a JSON value.");
        }
      } else {
        source = { kind: "tx", txHash: txHash! };
      }
      const client = new VeyaClient({
        rpcUrl: cfg.rpcUrl,
        contractAddress: cfg.contractAddress,
        chainId: cfg.chainId,
        explorerUrl: cfg.explorerUrl,
        payerPrivateKey: anchor ? payerPrivateKey : undefined,
      });
      try {
        const proof = await client.proveInput(source, { anchor: Boolean(anchor), environmentId });
        return {
          isError: !proof.ok,
          content: [{ type: "text" as const, text: JSON.stringify(proof, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return refused(message);
      }
    },
  );
}

function refused(refusal: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ ok: false, mode: "refused", anchored: false, refusal }, null, 2),
      },
    ],
  };
}
