# Verification Guide — `@veyanet/mcp`

How a public user or auditor proves this MCP talks to the selected Robinhood Chain profile. This tree defaults to **Mainnet**. **Testnet** is optional: `ROBINHOOD_NETWORK=testnet`.

You need a browser, `curl`, an MCP client (or this repo’s smoke script if you are an operator), and optionally `@veyanet/sdk` from npm.

**[Quickstart](./QUICKSTART.md)** • **[Network pin](./NETWORK_PIN.md)** • **[Tools](./TOOLS.md)** • **[Architecture](./ARCHITECTURE.md)**

---

## Table of contents

1. [What you are proving](#1-what-you-are-proving)
2. [Procedure A — public reads (no keys)](#2-procedure-a--public-reads-no-keys)
3. [Procedure B — product API service info](#3-procedure-b--product-api-service-info)
4. [Procedure C — standalone SDK check](#4-procedure-c--standalone-sdk-check)
5. [Procedure D — own-wallet writes](#5-procedure-d--own-wallet-writes)
6. [Repo scripts](#6-repo-scripts)
7. [Evidence pack](#7-evidence-pack)
8. [Pass / fail table](#8-pass--fail-table)
9. [Procedure E — Metered Call Guard runs](#9-procedure-e--metered-call-guard-runs)

---

## 1. What you are proving

Three facts:

1. The MCP host is up (`/health`, `veya_describe`): the selected profile, sealed = **AES-256-GCM**. This tree's default is Mainnet.
2. The Robinhood Chain RPC answers on that profile (`veya_ping_chain`). The SDK checks the RPC chain internally and fails closed on a mismatch.
3. A known (or newly written) `Veya.sol` transaction parses, and optionally the `commitments(digest)` mapping still returns true.

A pass means those facts match the live host. Product API /health shows ok or degraded (fleet status). Guest sessions are Use-only. Quorum is matching hashes: if validators are unreachable, `consensus_reached` is false.

---

## 2. Procedure A — public reads (no keys)

### A1. MCP health

```bash
curl -s https://mcp.veyanet.tech/health
```

Require:

| Field | Expected |
|-------|----------|
| `service` | `@veyanet/mcp` |
| `sealed` | contains `AES-256-GCM` |
| `settlement` | Robinhood Chain plus the selected profile |
| `publicMcpUrl` | `https://mcp.veyanet.tech/mcp` |
| `writesEnabled` | `true` (own-wallet tools). Check `operatorRelayerWrites` is `false` on the public host |
| `network` | `mainnet` (or `testnet` on a Testnet host) |
| `contractAddress` | `0x87dC582eEA544A434a5C1e30Ca3d12c1e548a674` (Mainnet) |

### A2. Describe

Connect Streamable HTTP to `https://mcp.veyanet.tech/mcp`. Call `veya_describe`.

Cross-check name `@veyanet/mcp`, version, contract, RPC, explorer, `sealed` text (AES-256-GCM), fleet sentence (capacity behind product API).

### A3. Ping

Call `veya_ping_chain`.

A recent block number and the expected contract mean the RPC is alive and on the selected profile. The chain ID is checked inside the SDK and is not part of the reply. If the SDK reports `CHAIN_MISMATCH`, **stop**: the host is mis-pinned.

### A4. Verify a known transaction

Call `veya_verify_transaction` with:

```text
0xa09f361779af4910157906937d54fc1f670fc7e6044aa06e62f25f5cca07461c
```

Open:

```text
https://robinhoodchain.blockscout.com/tx/0xa09f361779af4910157906937d54fc1f670fc7e6044aa06e62f25f5cca07461c
```

Confirm the explorer `to` address is `Veya.sol` and the tool’s parsed digest/events match the receipt. This is a Mainnet `storeCommitment` transaction on `Veya.sol` (a Metered Call Guard run record).

### A5. Stronger on-chain mapping check

Call `veya_verify_commitment_onchain` with the same hash (or `veya_commitment_exists` with a digest from the receipt). That is `eth_call commitments(bytes32)`, not only log parsing.

---

## 3. Procedure B — product API service info

Call `veya_api_health` (or `curl -s https://api.veyanet.tech/health`).

Read `status`. If `degraded`, read `validators.reachable` / `sealed.reachable`. MCP describe/ping can still pass. Do **not** fail the MCP host solely because fleet is down — fail fleet-dependent tools instead.

Optional: `veya_public_stats` should return JSON from `/public/stats` (HTTP status in the wrapper).

Optional guest path: `veya_guest_login` then `veya_list_proofs`. Build tools as guest must be **403**.

---

## 4. Procedure C — standalone SDK check

MCP and SDK must agree on pins. From any machine:

```bash
npm install @veyanet/sdk
```

Use `VeyaClient` on the same profile as the MCP host. The SDK default is Mainnet. Pass `network: "testnet"` when the host is Testnet. Call `pingChain()` and `verifyTransaction(txHash)` (or this repo’s sibling SDK examples if you cloned [veyanet/veya-sdk](https://github.com/veyanet/veya-sdk)).

If the SDK profile (network, contract) and MCP health disagree, MCP env is wrong.

---

## 5. Procedure D — own-wallet writes

1. Confirm write tools exist (`tools/list` includes `veya_store_commitment`).
2. Call `veya_writes_status` — own-wallet writes, not hosted signer.
3. Call a write **without** `apiKey` — `{ "error": "apiKey required" }`.
4. Call a write with a random unfunded `payerPrivateKey` after a valid `apiKey` (or expect API-key reject first). Empty wallet must return: `You don't have testnet tokens. Please get them for the transaction.`
5. With a real product key **and** that same funded wallet, call `veya_store_commitment` or `veya_anchor_proof`. Result `from` must be the user address.
6. Call `veya_verify_transaction` on the returned `txHash`.

Public paste URL still allows reads with no key. Prefer self-host for `VEYA_PAYER_PRIVATE_KEY`.

`scripts/verify-full.ts` automates local user vs product-key checks. It **must not print secrets**.

---

## 6. Repo scripts

| Command | What it checks |
|---------|----------------|
| `npm run smoke` | In-process `initialize`, `tools/list` (51 tools), `veya_describe`, `veya_ping_chain` |
| `npm test` | Unit tests (config, etc.) and the Metered Call Guard suite in `src/paid/` (mock money; needs the three validator nodes running) |
| `npm run lint` | `tsc --noEmit` |
| `tsx scripts/verify-full.ts` | Local MCP workflow: reads need no key, apiKey required for product tools, unfunded payer message |
| `tsx scripts/verify-live.ts` | Live public endpoints (operator) |

Public users can stop at Procedure A + explorer.

---

## 7. Evidence pack

Keep these artifacts for diligence:

| Artifact | How |
|----------|-----|
| MCP `/health` JSON | `curl` |
| `veya_describe` JSON | MCP client |
| `veya_ping_chain` JSON | MCP client |
| Explorer tx link | Tool `explorer` field or pin above |
| SDK verify output | `npm install @veyanet/sdk` |
| Package version | health `version` vs npm `@veyanet/mcp` |
| API `/health` | May be degraded — include as-is |

---

## 8. Pass / fail table

| Check | Pass |
|-------|------|
| Describe sealed | AES-256-GCM |
| Ping `config.network` | Same network as health `network` |
| Known tx verify | Parses `Veya.sol` events; explorer agrees |
| Health `writesEnabled` | `true` (own-wallet tools registered); `operatorRelayerWrites` is `false` on the public host |
| Guest Build from MCP | refused / mint product API key |
| Unfunded payer | Mainnet empty-wallet sentence, or the exact testnet-tokens sentence on Testnet |
| Consensus with fleet down | `consensus_reached: false` or tool error |

Related: [AUTHENTICATION.md](./AUTHENTICATION.md) for product keys and own-wallet gas.

---

## 9. Procedure E — Metered Call Guard runs

Only for hosts with `VEYA_PAID_CALLS=1`. See [PAID_CALLS.md](./PAID_CALLS.md).

1. `tools/list` shows **54 tools**, including `veya_paid_discover`, `veya_paid_call`, `veya_paid_run`, and no transfer, swap, trade or key tool.
2. Open the receipt: `GET /receipts/paid/<runId>` (or `.json`).
3. **Payment.** Open the Solscan link. The transaction is finalized and moves the quoted amount of the pinned mint from the caller's wallet (the receipt's payer address) to the payee.
4. **Validators.** The receipt shows at least 2 of 3 validators agreed.
5. **Record.** Open the Blockscout link. The transaction calls `storeCommitment` on `Veya.sol`. `veya_verify_commitment_onchain` or `veya_commitment_exists` with the receipt's commitment returns `exists: true`.
6. **Idempotency.** Calling `veya_paid_call` again with the same `idempotencyKey` returns the same `runId` with `replay: true` and no new Solana transaction.

| Check | Pass |
|-------|------|
| Blocked call | `decision: "blocked"`, a deny code, no `payment` field |
| No `apiKey` / Solana key / Robinhood Chain key | `API_KEY_REQUIRED` / `SOLANA_KEY_REQUIRED` / `ROBINHOOD_KEY_REQUIRED`, no `runId` |
| Saved to account | `account.saved: true`; `veya_paid_run` with your `apiKey` lists the run; another account's key reads `unknown run` |
| Record sender | Blockscout `from` equals the address of your `robinhoodPrivateKey` (`veya.from`) |
| Allowed call | `state: "committed"`, all three statuses `true` |
| Payment | Solscan: finalized, amount, mint, payee match the quote |
| Record | Blockscout: `storeCommitment` succeeded; commitment exists on chain |
| Replay | Same `runId`, `replay: true`, no new payment |
