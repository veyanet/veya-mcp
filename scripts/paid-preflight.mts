import { readFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Wallet, hexlify, randomBytes } from "ethers";
import { loadPaidConfig } from "../src/paid/config.js";
const cfg = loadPaidConfig();
const p = new JsonRpcProvider(cfg.robinhood.rpc, cfg.robinhood.chainId, { staticNetwork: true });
const w = new Wallet(readFileSync(process.env.VEYA_PAID_ANCHOR_KEY_PATH!, "utf8").trim(), p);
console.log("anchor wallet", w.address.slice(0, 6) + "..." + w.address.slice(-4), "ETH", (await p.getBalance(w.address)).toString());
const c = new Contract(cfg.robinhood.contract, ["function storeCommitment(bytes16,bytes32)"], w);
const env = "0x" + cfg.robinhood.environmentUuid.replace(/-/g, "");
await c.storeCommitment.staticCall(env, hexlify(randomBytes(32)));
const gas = await c.storeCommitment.estimateGas(env, hexlify(randomBytes(32)));
const fee = await p.getFeeData();
console.log("storeCommitment simulate OK; gas", gas.toString(), "est cost wei", (gas * (fee.maxFeePerGas ?? fee.gasPrice!)).toString());
for (const [label, rpc] of cfg.solana.rpcs.map((r, i) => [i, r] as const)) {
  try {
    const r = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [cfg.solana.payer, { mint: cfg.resources[0].x402.asset }, { encoding: "jsonParsed", commitment: "finalized" }] }) })).json() as any;
    const sol = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [cfg.solana.payer] }) })).json() as any;
    console.log("rpc", label, "USDC", r.result?.value?.[0]?.account.data.parsed.info.tokenAmount.uiAmountString, "SOL lamports", sol.result?.value, r.error?.message ?? "");
  } catch (e) { console.log("rpc", label, "ERR", (e as Error).message); }
}
