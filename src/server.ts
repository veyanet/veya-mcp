import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  MCP_SERVICE_NAME,
  MCP_SERVICE_VERSION,
  type McpServiceConfig,
} from "./config.js";
import { registerPublicTools } from "./tools/public.js";
import { registerProofTools } from "./tools/proof.js";
import { registerSealDecisionTools } from "./tools/sealDecision.js";
import { registerWriteTools } from "./tools/write.js";
import { registerCryptoTools } from "./tools/crypto.js";
import { registerFleetTools } from "./tools/fleet.js";
import { registerRegistryTools } from "./tools/registry.js";
import { registerProductTools } from "./tools/product.js";
import { registerPaidCallTools } from "./paid/tools.js";

export function createMcpServer(cfg: McpServiceConfig): McpServer {
  const server = new McpServer({
    name: MCP_SERVICE_NAME,
    version: MCP_SERVICE_VERSION,
  });

  registerPublicTools(server, cfg);
  registerProofTools(server, cfg);
  registerSealDecisionTools(server, cfg);
  registerCryptoTools(server, cfg);
  registerFleetTools(server, cfg);
  registerRegistryTools(server, cfg);
  registerProductTools(server, cfg);
  registerWriteTools(server, cfg);
  // VEYA Metered Call Guard: opt-in only, so the hosted surface is unchanged unless enabled.
  if (process.env.VEYA_PAID_CALLS === "1") registerPaidCallTools(server);

  return server;
}
