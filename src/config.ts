export type McpServiceConfig = {
  port: number;
  host: string;
  publicMcpUrl: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  contractAddress: string;
  apiUrl: string;
  mcpApiKey: string | null;
  relayerPrivateKey: string | null;
  corsOrigins: string[];
  nodeEnv: string;
};

export const MCP_SERVICE_NAME = "@veyanet/mcp";
export const MCP_SERVICE_VERSION = "1.0.0";

export function loadConfig(): McpServiceConfig {
  const mcpApiKey = process.env.MCP_API_KEY?.trim() || null;
  const relayer =
    process.env.VEYA_RELAYER_PRIVATE_KEY?.trim() ||
    process.env.VEYA_DEPLOYER_PRIVATE_KEY?.trim() ||
    null;

  return {
    port: Number(process.env.PORT || 8788),
    host: process.env.HOST || "0.0.0.0",
    publicMcpUrl: (process.env.PUBLIC_MCP_URL || "https://mcp.veyanet.tech/mcp").replace(/\/$/, ""),
    chainId: Number(process.env.ROBINHOOD_CHAIN_ID || 46630),
    rpcUrl: process.env.ROBINHOOD_RPC_URL || "https://rpc.testnet.chain.robinhood.com",
    explorerUrl:
      process.env.ROBINHOOD_EXPLORER_URL || "https://explorer.testnet.chain.robinhood.com",
    contractAddress:
      process.env.VEYA_CONTRACT_ADDRESS || "0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84",
    apiUrl: (process.env.VEYA_API_URL || "https://api.veyanet.tech").replace(/\/$/, ""),
    mcpApiKey,
    relayerPrivateKey: relayer,
    corsOrigins: (process.env.CORS_ORIGIN || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    nodeEnv: process.env.NODE_ENV || "development",
  };
}

export function writesEnabled(cfg: McpServiceConfig): boolean {
  return Boolean(cfg.mcpApiKey && cfg.relayerPrivateKey);
}
