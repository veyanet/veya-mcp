import type { McpServiceConfig } from "./config.js";

export type ApiResult = {
  httpStatus: number;
  body: unknown;
};

export async function apiRequest(
  cfg: McpServiceConfig,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    sessionToken?: string | null;
  } = {},
): Promise<ApiResult> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.sessionToken) {
    headers.Authorization = `Bearer ${options.sessionToken}`;
  }

  const res = await fetch(`${cfg.apiUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });

  const body = await res.json().catch(async () => ({
    raw: await res.text().catch(() => null),
  }));

  return { httpStatus: res.status, body };
}

export function toolJson(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function toolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true as const,
  };
}
