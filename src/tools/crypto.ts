import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pq } from "@veyanet/sdk";
import { createReadClient } from "../sdk.js";
import type { McpServiceConfig } from "../config.js";
import { toolError, toolJson } from "../api.js";

function hexToBytes(hex: string): Uint8Array {
  const h = hex.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]*$/.test(h) || h.length % 2 !== 0) {
    throw new Error("Expected even-length hex string");
  }
  return Uint8Array.from(Buffer.from(h, "hex"));
}

export function registerCryptoTools(server: McpServer, cfg: McpServiceConfig): void {
  server.tool(
    "veya_pq_keygen",
    "Generate an ML-DSA-44 post-quantum identity keypair (local, no chain write)",
    {},
    async () => {
      try {
        const client = createReadClient(cfg);
        const keys = await client.pqKeygen();
        const publicKeyHash = await pq.publicKeyHashBlake3(keys.publicKey);
        return toolJson({
          publicKeyHex: Buffer.from(keys.publicKey).toString("hex"),
          privateKeyHex: Buffer.from(keys.privateKey).toString("hex"),
          publicKeyHash,
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_pq_sign",
    "Sign UTF-8 text with ML-DSA-44",
    {
      message: z.string().min(1),
      privateKeyHex: z.string().min(8),
    },
    async ({ message, privateKeyHex }) => {
      try {
        const signatureHex = await pq.signUtf8(message, hexToBytes(privateKeyHex));
        return toolJson({ signatureHex });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_pq_verify",
    "Verify an ML-DSA-44 signature over UTF-8 text",
    {
      message: z.string().min(1),
      signatureHex: z.string().min(8),
      publicKeyHex: z.string().min(8),
    },
    async ({ message, signatureHex, publicKeyHex }) => {
      try {
        const valid = await pq.verifyUtf8(
          signatureHex,
          message,
          hexToBytes(publicKeyHex),
        );
        return toolJson({ valid });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
