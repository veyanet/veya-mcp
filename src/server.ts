import { AsyncLocalStorage } from "node:async_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  MCP_SERVICE_NAME,
  MCP_SERVICE_VERSION,
  type McpServiceConfig,
} from "./config.js";
import { registerPublicTools } from "./tools/public.js";
import { registerWriteTools } from "./tools/write.js";

export const requestAuth = new AsyncLocalStorage<{ bearer: string | null }>();

export function createMcpServer(cfg: McpServiceConfig): McpServer {
  const server = new McpServer({
    name: MCP_SERVICE_NAME,
    version: MCP_SERVICE_VERSION,
  });

  registerPublicTools(server, cfg);
  registerWriteTools(server, cfg, () => requestAuth.getStore()?.bearer ?? null);

  return server;
}
