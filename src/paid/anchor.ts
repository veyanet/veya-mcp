/** Anchor the run commitment on Veya.sol (Robinhood Chain Mainnet) via storeCommitment(bytes16,bytes32). */
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import type { PaidConfig } from "./config.js";

const ABI = [
  "function storeCommitment(bytes16 environmentUuid, bytes32 commitment)",
  "function commitments(bytes32) view returns (address authority, bytes16 environmentUuid, bytes32 commitment, uint64 timestamp, bool exists)",
  "function environments(bytes16) view returns (address owner, bytes16 uuid, bytes32 pqPubkeyHash, uint8 envType, uint64 createdAt, uint32 revision, bool exists)",
];
export const uuidToBytes16 = (u: string) => "0x" + u.replace(/-/g, "").toLowerCase();

export interface Anchorer { anchor(commitmentHex: string): Promise<{ txHash: string; blockNumber: number; alreadyExisted: boolean }>; }

// Serialize anchor sends in this process so parallel runs never reuse a nonce.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const p = queue.then(fn, fn); queue = p.catch(() => undefined); return p; };

export function createAnchorer(cfg: PaidConfig, privateKey: string): Anchorer {
  return {
    anchor: (commitmentHex) => serial(async () => {
      const provider = new JsonRpcProvider(cfg.robinhood.rpc, cfg.robinhood.chainId, { staticNetwork: true });
      const wallet = new Wallet(privateKey, provider);
      const c = new Contract(cfg.robinhood.contract, ABI, wallet);
      const existing = await c.commitments(commitmentHex);
      if (existing.exists) return { txHash: "", blockNumber: 0, alreadyExisted: true }; // duplicate: never re-send
      const env = uuidToBytes16(cfg.robinhood.environmentUuid);
      await c.storeCommitment.staticCall(env, commitmentHex); // simulate first: no gas burnt on revert
      const tx = await c.storeCommitment(env, commitmentHex);
      const rc = await tx.wait(1);
      if (!rc || rc.status !== 1) throw new Error("storeCommitment reverted");
      return { txHash: tx.hash, blockNumber: rc.blockNumber, alreadyExisted: false };
    }),
  };
}
