/**
 * 2-of-3 validator quorum. Each validator independently re-checks the run (policy decision
 * against the pinned config, Solana payment on its OWN RPC at finalized, result shape) and
 * submits its verdict to its own VEYA validator-node (Rust, ML-DSA-44 + BLAKE3) for signing.
 * Quorum = >=threshold nodes whose signed BLAKE3 hash matches the expected verdict hash AND
 * whose ML-DSA signature verifies.
 */
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import type { PaidConfig } from "./config.js";
import { evaluatePolicy, type Quote } from "./policy.js";
import { verifySolanaPayment } from "./solana.js";

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
}
export const blake3Hex = (s: string | Uint8Array) => bytesToHex(blake3(typeof s === "string" ? new TextEncoder().encode(s) : s));

export type RunEvidence = {
  runId: string; tool: string; resourceId: string; resourceUrl: string; quote: Quote; taskBudgetAtomic: string;
  payment: { signature: string; payer: string; payTo: string; mint: string; amountAtomic: string };
  resultHash: string; resultOk: boolean;
};
export type Verdict = { runId: string; policy: "allow" | "deny"; payment: "verified" | "mismatch" | "unverifiable"; result: "ok" | "bad"; resultHash: string; paymentSig: string };

export async function computeVerdict(cfg: PaidConfig, ev: RunEvidence, rpc: string, fetchImpl: typeof fetch = fetch): Promise<Verdict> {
  const p = evaluatePolicy(cfg, { tool: ev.tool, resourceUrl: ev.resourceUrl, resourceId: ev.resourceId, quote: ev.quote, taskBudgetAtomic: BigInt(ev.taskBudgetAtomic) });
  const pay = await verifySolanaPayment(rpc, ev.payment, fetchImpl);
  return { runId: ev.runId, policy: p.allow ? "allow" : "deny", payment: pay.status, result: ev.resultOk ? "ok" : "bad", resultHash: ev.resultHash, paymentSig: ev.payment.signature };
}
export const expectedVerdict = (ev: RunEvidence): Verdict => ({ runId: ev.runId, policy: "allow", payment: "verified", result: "ok", resultHash: ev.resultHash, paymentSig: ev.payment.signature });

type NodeResult = { node_id: string; blake3_execution_hash: string; mldsa_signature: string; mldsa_public_key_hex: string; status: string };
export type NodeOutcome = { node: string; rpc?: string; ok: boolean; reason?: string; nodeId?: string; hash?: string; pubkeyHash?: string; verdict?: Verdict };
export type QuorumResult = { reached: boolean; agreed: number; threshold: number; expectedHash: string; nodes: NodeOutcome[] };

const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

export async function runQuorum(cfg: PaidConfig, ev: RunEvidence, opts: { fetchImpl?: typeof fetch; nodeTimeoutMs?: number } = {}): Promise<QuorumResult> {
  const f = opts.fetchImpl ?? fetch;
  const expected = expectedVerdict(ev);
  const expectedHash = blake3Hex(canonicalJson(expected));
  const outcomes = await Promise.all(cfg.validators.nodes.map(async (node, i): Promise<NodeOutcome> => {
    const rpc = cfg.validators.rpcs[i];
    try {
      const verdict = await computeVerdict(cfg, ev, rpc, f);
      const res = await f(node + "/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task_id: ev.runId, payload: verdict }), signal: AbortSignal.timeout(opts.nodeTimeoutMs ?? 10000) });
      if (!res.ok) return { node, ok: false, reason: `node http ${res.status}`, verdict };
      const { result } = (await res.json()) as { result: NodeResult };
      const localHash = blake3Hex(canonicalJson(verdict));
      const sigOk = result.status === "success" && ml_dsa44.verify(hexToBytes(result.mldsa_signature), hexToBytes(result.blake3_execution_hash), hexToBytes(result.mldsa_public_key_hex));
      if (!sigOk) return { node, ok: false, reason: "ML-DSA signature invalid", nodeId: result.node_id, hash: result.blake3_execution_hash, verdict };
      if (result.blake3_execution_hash !== localHash) return { node, ok: false, reason: "node hash != submitted verdict hash (dissent)", nodeId: result.node_id, hash: result.blake3_execution_hash, verdict };
      if (localHash !== expectedHash) return { node, ok: false, reason: `verdict disagrees: ${verdict.policy}/${verdict.payment}/${verdict.result}`, nodeId: result.node_id, hash: localHash, verdict };
      return { node, rpc, ok: true, nodeId: result.node_id, hash: localHash, pubkeyHash: blake3Hex(hexToBytes(result.mldsa_public_key_hex)), verdict };
    } catch (err) {
      return { node, ok: false, reason: `unreachable: ${(err as Error).message}` };
    }
  }));
  const agreed = outcomes.filter((o) => o.ok).length;
  return { reached: agreed >= cfg.validators.threshold, agreed, threshold: cfg.validators.threshold, expectedHash, nodes: outcomes };
}
