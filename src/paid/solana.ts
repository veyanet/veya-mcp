/** Independent Solana payment verification over RPC at `finalized`. Never trusts the returned sig alone. */
export type PaymentExpectation = { signature: string; payer: string; payTo: string; mint: string; amountAtomic: string };
export type PaymentCheck =
  | { status: "verified"; slot: number; blockTime: number | null; payerDelta: string; payeeDelta: string; feePayer: string; rpc: string }
  | { status: "mismatch"; reason: string; rpc: string }
  | { status: "unverifiable"; reason: string; rpc: string };

type TokenBal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } };

async function rpcCall(rpc: string, method: string, params: unknown[], fetchImpl: typeof fetch, timeoutMs: number) {
  const res = await fetchImpl(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`rpc http ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(`rpc error ${j.error.message}`);
  return j.result;
}

export async function verifySolanaPayment(rpc: string, e: PaymentExpectation, fetchImpl: typeof fetch = fetch, timeoutMs = 20000): Promise<PaymentCheck> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(e.signature)) return { status: "mismatch", reason: "signature is not base58", rpc };
  let tx: any;
  try {
    tx = await rpcCall(rpc, "getTransaction", [e.signature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }], fetchImpl, timeoutMs);
  } catch (err) {
    return { status: "unverifiable", reason: `RPC unavailable: ${(err as Error).message}`, rpc };
  }
  if (!tx) return { status: "unverifiable", reason: "not found at finalized (yet)", rpc };
  if (tx.meta?.err) return { status: "mismatch", reason: `tx failed: ${JSON.stringify(tx.meta.err)}`, rpc };
  const delta = (owner: string) => {
    const sum = (arr: TokenBal[] = []) => arr.filter((b) => b.mint === e.mint && b.owner === owner).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    return sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
  };
  const payerDelta = delta(e.payer), payeeDelta = delta(e.payTo);
  if (payeeDelta !== BigInt(e.amountAtomic)) return { status: "mismatch", reason: `payee received ${payeeDelta}, expected ${e.amountAtomic}`, rpc };
  if (payerDelta !== -BigInt(e.amountAtomic)) return { status: "mismatch", reason: `payer delta ${payerDelta}, expected -${e.amountAtomic}`, rpc };
  const keys = tx.transaction.message.accountKeys.map((k: any) => (typeof k === "string" ? k : k.pubkey));
  const signers = tx.transaction.message.accountKeys.filter((k: any) => k.signer).map((k: any) => k.pubkey);
  if (!signers.includes(e.payer)) return { status: "mismatch", reason: "payer did not sign", rpc };
  return { status: "verified", slot: tx.slot, blockTime: tx.blockTime ?? null, payerDelta: payerDelta.toString(), payeeDelta: payeeDelta.toString(), feePayer: keys[0], rpc };
}

/** Recent payer signatures (for evidence when a call errors after payment may have moved). */
export async function recentSignatures(rpc: string, address: string, limit = 5, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const r = (await rpcCall(rpc, "getSignaturesForAddress", [address, { limit, commitment: "confirmed" }], fetchImpl, 15000)) as { signature: string }[];
  return r.map((x) => x.signature);
}
