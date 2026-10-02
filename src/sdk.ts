import { VeyaClient } from "@veyanet/sdk";
import type { McpServiceConfig } from "./config.js";

function refuseUnpublished(cfg: McpServiceConfig): void {
  if (cfg.network === "mainnet" && !cfg.contractAddress) {
    throw new Error(
      "MAINNET_UNPUBLISHED: Veya.sol is not published on Robinhood Chain mainnet. Nothing was sent.",
    );
  }
}

export function createReadClient(cfg: McpServiceConfig): VeyaClient {
  return new VeyaClient({
    rpcUrl: cfg.rpcUrl,
    contractAddress: cfg.contractAddress,
    chainId: cfg.chainId,
    explorerUrl: cfg.explorerUrl,
    validatorNodes: cfg.validatorNodes,
    sealedNodeUrl: cfg.sealedNodeUrl,
  });
}

export function createWriteClient(cfg: McpServiceConfig, payerPrivateKey: string): VeyaClient {
  refuseUnpublished(cfg);
  return new VeyaClient({
    rpcUrl: cfg.rpcUrl,
    contractAddress: cfg.contractAddress,
    chainId: cfg.chainId,
    explorerUrl: cfg.explorerUrl,
    payerPrivateKey,
    validatorNodes: cfg.validatorNodes,
    sealedNodeUrl: cfg.sealedNodeUrl,
  });
}

export function parseHexBytes(value: string, expectedLen?: number): Uint8Array {
  const hex = value.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Expected even-length hex string");
  }
  const buf = Buffer.from(hex, "hex");
  if (expectedLen !== undefined && buf.length !== expectedLen) {
    throw new Error(`Expected ${expectedLen} bytes, got ${buf.length}`);
  }
  return Uint8Array.from(buf);
}
