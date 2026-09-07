import { VeyaClient } from "@veyanet/sdk";
import type { McpServiceConfig } from "./config.js";

export function createReadClient(cfg: McpServiceConfig): VeyaClient {
  return new VeyaClient({
    rpcUrl: cfg.rpcUrl,
    contractAddress: cfg.contractAddress,
    chainId: cfg.chainId,
    explorerUrl: cfg.explorerUrl,
  });
}

export function createWriteClient(cfg: McpServiceConfig): VeyaClient {
  if (!cfg.relayerPrivateKey) {
    throw new Error("VEYA_RELAYER_PRIVATE_KEY required for write tools");
  }
  return new VeyaClient({
    rpcUrl: cfg.rpcUrl,
    contractAddress: cfg.contractAddress,
    chainId: cfg.chainId,
    explorerUrl: cfg.explorerUrl,
    payerPrivateKey: cfg.relayerPrivateKey,
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
