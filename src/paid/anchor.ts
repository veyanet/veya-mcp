/** Anchor the run commitment on Veya.sol (Robinhood Chain Mainnet) via storeCommitment(bytes16,bytes32). */
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import type { PaidConfig } from "./config.js";

const ABI = [
  "function storeCommitment(bytes16 environmentUuid, bytes32 commitment)",
  "function commitments(bytes32) view returns (address authority, bytes16 environmentUuid, bytes32 commitment, uint64 timestamp, bool exists)",
  "function environments(bytes16) view returns (address owner, bytes16 uuid, bytes32 pqPubkeyHash, uint8 envType, uint64 createdAt, uint32 revision, bool exists)",
];
export const uuidToBytes16 = (u: string) => "0x" + u.replace(/-/g, "").toLowerCase();

export interface Anchorer { anchor(commitmentHex: string): Promise<{ txHash: string; blockNumber: number; alreadyExisted: boolean; from?: string }>; }

// Serialize anchor sends in this process so parallel runs never reuse a nonce.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const p = queue.then(fn, fn); queue = p.catch(() => undefined); return p; };

export function createAnchorer(cfg: PaidConfig, privateKey: string, environmentUuid = cfg.robinhood.environmentUuid): Anchorer {
  return {
    anchor: (commitmentHex) => serial(async () => {
      const provider = new JsonRpcProvider(cfg.robinhood.rpc, cfg.robinhood.chainId, { staticNetwork: true });
      const wallet = new Wallet(privateKey, provider);
      const c = new Contract(cfg.robinhood.contract, ABI, wallet);
      const existing = await c.commitments(commitmentHex);
      if (existing.exists) return { txHash: "", blockNumber: 0, alreadyExisted: true, from: existing.authority }; // duplicate: never re-send
      const env = uuidToBytes16(environmentUuid);
      await c.storeCommitment.staticCall(env, commitmentHex); // simulate first: no gas burnt on revert
      const tx = await c.storeCommitment(env, commitmentHex);
      const rc = await tx.wait(1);
      if (!rc || rc.status !== 1) throw new Error("storeCommitment reverted");
      return { txHash: tx.hash, blockNumber: rc.blockNumber, alreadyExisted: false, from: wallet.address };
    }),
  };
}

/** Read-only checks before anything is signed: the environment exists on Veya.sol and the signer has ETH for one storeCommitment. */
export async function anchorPreflight(cfg: PaidConfig, address: string, environmentUuid: string, who: "your" | "the"): Promise<string | null> {
  const provider = new JsonRpcProvider(cfg.robinhood.rpc, cfg.robinhood.chainId, { staticNetwork: true });
  const c = new Contract(cfg.robinhood.contract, ABI, provider);
  const env = await c.environments(uuidToBytes16(environmentUuid));
  if (!env.exists) return `ENVIRONMENT_NOT_FOUND: environment ${environmentUuid} is not registered on Veya.sol. Omit environmentUuid to use the default VEYA environment, or register yours with veya_register_environment. Nothing was signed or spent.`;
  const [bal, fee] = await Promise.all([provider.getBalance(address), provider.getFeeData()]);
  const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const need = price * ANCHOR_GAS_LIMIT;
  if (bal === 0n || bal < need) return `ROBINHOOD_INSUFFICIENT_GAS: ${who} Robinhood Chain wallet ${address} holds ${bal} wei ETH; recording this run needs about ${need} wei. Add ETH and try again. Nothing was signed or spent.`;
  return null;
}
/** Generous upper bound for one storeCommitment (measured ~116k on mainnet). */
export const ANCHOR_GAS_LIMIT = 250000n;
