import type { Request } from "express";
import type { McpServiceConfig } from "./config.js";

export function extractBearer(req: Request): string | null {
  const h = req.header("authorization") || req.header("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

/** Write tools require MCP_API_KEY match. Fail closed if key unset. */
export function assertWriteAuthorized(cfg: McpServiceConfig, bearer: string | null): void {
  if (!cfg.mcpApiKey) {
    throw new Error(
      "Write tools disabled on this server (set MCP_API_KEY + VEYA_RELAYER_PRIVATE_KEY)",
    );
  }
  if (!bearer || bearer !== cfg.mcpApiKey) {
    throw new Error("Unauthorized: provide Authorization: Bearer <MCP_API_KEY>");
  }
  if (!cfg.relayerPrivateKey) {
    throw new Error("Write tools disabled: VEYA_RELAYER_PRIVATE_KEY not configured");
  }
}
