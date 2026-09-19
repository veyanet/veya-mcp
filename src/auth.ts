import type { Request } from "express";

/** HTTP Bearer is unused on the user-paid write path. Kept for MCP session clients. */
export function extractBearer(req: Request): string | null {
  const h = req.header("authorization") || req.header("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}
