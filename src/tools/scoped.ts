import type { McpServiceConfig } from "../config.js";
import { apiRequest, safeRequestMessage, toolApiResult, toolError, type ApiResult } from "../api.js";
import { requireProductApiKey } from "../credentials.js";

export function scopedKey(apiKey?: string | null): string | { error: ReturnType<typeof toolError> } {
  try {
    return requireProductApiKey(apiKey);
  } catch (err) {
    return { error: toolError(err) };
  }
}

export async function scopedApi(
  cfg: McpServiceConfig,
  key: string,
  path: string,
  method: string,
  body?: unknown,
): Promise<ApiResult | { error: ReturnType<typeof toolError> }> {
  try {
    const result = await apiRequest(cfg, path, { method, apiKey: key, body });
    return result;
  } catch (err) {
    return { error: toolError(new Error(safeRequestMessage(err))) };
  }
}

export function asTool(result: ApiResult | { error: ReturnType<typeof toolError> }) {
  if ("error" in result) return result.error;
  return toolApiResult(result);
}
