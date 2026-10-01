import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export type McpServiceConfig = {
  port: number;
  host: string;
  publicMcpUrl: string;
  /** Default is mainnet. ROBINHOOD_NETWORK=testnet keeps chain 46630. */
  network: "testnet" | "mainnet";
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  /**
   * Veya.sol on chain 4663 when VEYA_MAINNET_CONTRACT_ADDRESS is unset.
   * An explicit empty string stays unpublished and sends nothing.
   */
  contractAddress: string;
  apiUrl: string;
  mcpApiKey: string | null;
  relayerPrivateKey: string | null;
  payerPrivateKey: string | null;
  validatorNodes: string[];
  sealedNodeUrl: string;
  /** Host override for veya_seal_decision. Mainnet refuses when this and the tool argument are both empty. */
  sealDecisionEnvironmentId: string | null;
  /** This tool only. Default off. Does not turn on operator relayer writes. */
  sealDecisionRelayer: boolean;
  corsOrigins: string[];
  nodeEnv: string;
};

export const MCP_SERVICE_NAME = "@veyanet/mcp";
/** Read from package.json (src/ and dist/ are both one level below the package root). */
function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
    return String(pkg.version);
  } catch {
    return "unknown";
  }
}
export const MCP_SERVICE_VERSION = readPackageVersion();

/** Veya.sol on Robinhood Chain 4663. Protocol contract, not a token. */
export const MAINNET_PROTOCOL_CONTRACT = "0x87dC582eEA544A434a5C1e30Ca3d12c1e548a674";

function mainnetContractAddress(): string {
  const raw = process.env.VEYA_MAINNET_CONTRACT_ADDRESS;
  if (raw === undefined) return MAINNET_PROTOCOL_CONTRACT;
  return raw.trim();
}

export function loadConfig(): McpServiceConfig {
  const mcpApiKey = process.env.MCP_API_KEY?.trim() || null;
  const network = (process.env.ROBINHOOD_NETWORK || "").trim().toLowerCase() === "testnet"
    ? "testnet"
    : "mainnet";
  const relayer =
    network === "mainnet"
      ? process.env.VEYA_MAINNET_RELAYER_PRIVATE_KEY?.trim() || null
      : process.env.VEYA_RELAYER_PRIVATE_KEY?.trim() ||
        process.env.VEYA_DEPLOYER_PRIVATE_KEY?.trim() ||
        null;
  const payerPrivateKey = process.env.VEYA_PAYER_PRIVATE_KEY?.trim() || null;
  const mainnet = network === "mainnet";

  return {
    port: Number(process.env.PORT || 8788),
    host: process.env.HOST || "0.0.0.0",
    publicMcpUrl: (process.env.PUBLIC_MCP_URL || "https://mcp.veyanet.tech/mcp").replace(/\/$/, ""),
    network,
    chainId: mainnet
      ? Number(process.env.ROBINHOOD_MAINNET_CHAIN_ID || 4663)
      : Number(process.env.ROBINHOOD_CHAIN_ID || 46630),
    rpcUrl: mainnet
      ? process.env.ROBINHOOD_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"
      : process.env.ROBINHOOD_RPC_URL || "https://rpc.testnet.chain.robinhood.com",
    explorerUrl: mainnet
      ? process.env.ROBINHOOD_MAINNET_EXPLORER_URL || "https://robinhoodchain.blockscout.com"
      : process.env.ROBINHOOD_EXPLORER_URL || "https://explorer.testnet.chain.robinhood.com",
    contractAddress: mainnet
      ? mainnetContractAddress()
      : process.env.VEYA_CONTRACT_ADDRESS || "0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84",
    apiUrl: (process.env.VEYA_API_URL || "https://api.veyanet.tech").replace(/\/$/, ""),
    mcpApiKey,
    relayerPrivateKey: relayer,
    payerPrivateKey,
    validatorNodes: (process.env.VEYA_VALIDATOR_NODES ||
      "http://127.0.0.1:7701,http://127.0.0.1:7702,http://127.0.0.1:7703")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    sealedNodeUrl: (process.env.VEYA_SEALED_NODE_URL || "http://127.0.0.1:7800").replace(/\/$/, ""),
    sealDecisionEnvironmentId: process.env.VEYA_SEAL_DECISION_ENVIRONMENT_ID?.trim() || null,
    sealDecisionRelayer: ["1", "true"].includes(
      (process.env.VEYA_SEAL_DECISION_RELAYER || "").trim().toLowerCase(),
    ),
    corsOrigins: (process.env.CORS_ORIGIN || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    nodeEnv: process.env.NODE_ENV || "development",
  };
}

/** Own-wallet write tools are always registered. */
export function writesEnabled(_cfg?: McpServiceConfig): boolean {
  return true;
}

/** Host relayer env is unused; own-wallet writes never set this true. */
export function operatorRelayerWritesEnabled(_cfg?: McpServiceConfig): boolean {
  return false;
}

/** Receipts for veya_seal_decision use the host relayer only when this is on. */
export function sealDecisionRelayerEnabled(cfg: McpServiceConfig): boolean {
  return cfg.sealDecisionRelayer;
}
