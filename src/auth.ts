import type { Request } from "express";

/** Bearer token for MCP_API_KEY on /mcp when that env var is set. */
export function extractBearer(req: Request): string | null {
  const h = req.header("authorization") || req.header("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}
