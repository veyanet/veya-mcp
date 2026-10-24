import type { McpServiceConfig } from "./config.js";
import { isProductApiKey } from "./credentials.js";

export type ApiResult = {
  httpStatus: number;
  body: unknown;
};

export function authHeaders(credential: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  const value = credential?.trim();
  if (!value) return headers;
  if (isProductApiKey(value)) {
    headers["X-Api-Key"] = value;
    headers.Authorization = `Bearer ${value}`;
  } else {
    headers.Authorization = `Bearer ${value}`;
  }
  return headers;
}

export async function apiRequest(
  cfg: McpServiceConfig,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    apiKey?: string | null;
    sessionToken?: string | null;
  } = {},
): Promise<ApiResult> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Veya-Network": cfg.network,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const credential = options.apiKey?.trim() || options.sessionToken?.trim() || null;
  Object.assign(headers, authHeaders(credential));

  const res = await fetch(`${cfg.apiUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });

  const text = await res.text().catch(() => "");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  return { httpStatus: res.status, body };
}

/** Short failure text that does not include the request URL or the API key. */
export function safeRequestMessage(err: unknown): string {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return "timeout";
  }
  return "API not reachable";
}

function jsonReplacer(key: string, value: unknown): unknown {
  if (key === "chainId" || key === "chainIdHex" || key === "expectedChainId" || key === "chosenChainId") return undefined;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString("hex")}`;
  if (value instanceof Error) return value.message;
  return value;
}

export function toolJson(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, jsonReplacer, 2) }],
  };
}

export function toolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true as const,
  };
}

/** Product/API JSON that must look like a failure to MCP clients when HTTP is 4xx/5xx. */
export function toolApiResult(result: ApiResult) {
  const payload = toolJson(result);
  if (result.httpStatus >= 400) {
    return { ...payload, isError: true as const };
  }
  return payload;
}
