# Verification Guide — `@veyanet/mcp`

How a stranger or auditor proves this MCP talks to **real** Robinhood testnet settlement.

You need a browser, `curl`, an MCP client (or this repo’s smoke script if you are an operator), and optionally `@veyanet/sdk` from npm.

**[Quickstart](./QUICKSTART.md)** • **[Network pin](./NETWORK_PIN.md)** • **[Tools](./TOOLS.md)** • **[Architecture](./ARCHITECTURE.md)**

---

## Table of contents

1. [What you are proving](#1-what-you-are-proving)
2. [Procedure A — public reads (no keys)](#2-procedure-a--public-reads-no-keys)
3. [Procedure B — product API honesty](#3-procedure-b--product-api-honesty)
4. [Procedure C — independent SDK check](#4-procedure-c--independent-sdk-check)
5. [Procedure D — operator writes (keys)](#5-procedure-d--operator-writes-keys)
6. [Repo scripts](#6-repo-scripts)
7. [Evidence pack](#7-evidence-pack)
8. [Pass / fail table](#8-pass--fail-table)

---

## 1. What you are proving

Three facts:

1. The MCP host is up and **honest** (`/health`, `veya_describe`): testnet **46630**, sealed = **AES-256-GCM**.
2. Robinhood RPC chain id is **46630** (`veya_ping_chain`).
3. A known (or newly written) `Veya.sol` transaction parses, and optionally the `commitments(digest)` mapping still returns true.

A pass means those facts match the live host. Product API `/health` may be `ok` or **`degraded`**. Degraded usually means fleet down; that is still an honest report. Guest sessions are Use-only. Quorum is matching hashes: if validators are unreachable, `consensus_reached` is false.

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
| `chainId` | `46630` |
| `sealed` | contains `AES-256-GCM` |
| `settlement` | Robinhood testnet 46630 |
| `publicMcpUrl` | `https://mcp.veyanet.tech/mcp` |
| `writesEnabled` | `false` on the public host (if `true`, treat as a policy surprise) |
| `contractAddress` | `0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84` |

### A2. Describe

Connect Streamable HTTP to `https://mcp.veyanet.tech/mcp`. Call `veya_describe`.

Cross-check name `@veyanet/mcp`, version, contract, RPC, explorer, `sealed` text (AES-256-GCM), fleet sentence (capacity behind product API).

### A3. Ping

Call `veya_ping_chain`.

Require `chainId` / `expectedChainId` **46630**. A recent block number means RPC is alive. If chain id differs, **stop** — the host is mis-pinned.

### A4. Verify a known transaction

Call `veya_verify_transaction` with:

```text
0xd68ab19671f0a3be63651cb6d6e24f5decf591da981708502827bca3689d31d8
```

Open:

```text
https://explorer.testnet.chain.robinhood.com/tx/0xd68ab19671f0a3be63651cb6d6e24f5decf591da981708502827bca3689d31d8
```

Confirm the explorer `to` address is `Veya.sol` and the tool’s parsed digest/events match the receipt. This tx is a sealed-execution **commitment** path used in docs — it does not prove FHE.

### A5. Stronger on-chain mapping check

Call `veya_verify_commitment_onchain` with the same hash (or `veya_commitment_exists` with a digest from the receipt). That is `eth_call commitments(bytes32)`, not only log parsing.

---

## 3. Procedure B — product API honesty

Call `veya_api_health` (or `curl -s https://api.veyanet.tech/health`).

Read `status`. If `degraded`, read `validators.reachable` / `sealed.reachable`. MCP describe/ping can still pass. Do **not** fail the MCP host solely because fleet is down — fail fleet-dependent tools instead.

Optional: `veya_public_stats` should return JSON from `/public/stats` (HTTP status in the wrapper).

Optional guest path: `veya_guest_login` then `veya_list_proofs`. Build tools as guest must be **403**.

---

## 4. Procedure C — independent SDK check

MCP and SDK must agree on pins. From any machine:

```bash
npm install @veyanet/sdk
```

Use `VeyaClient` defaults (chain 46630, same contract). Call `pingChain()` and `verifyTransaction(txHash)` (or this repo’s sibling SDK examples if you cloned [veyanet/veya-sdk](https://github.com/veyanet/veya-sdk)).

If SDK says 46630 and MCP health says otherwise, MCP env is wrong.

---

## 5. Procedure D — operator writes (keys)

Only on a **non-public** (or tightly controlled) MCP instance.

1. Confirm `veya_writes_status` is **absent** and write tools **exist** (`tools/list`).
2. Call `veya_hash_blake3` with a unique string.
3. With `Authorization: Bearer <MCP_API_KEY>`, call `veya_store_commitment` for a **16-byte** environment UUID already registered (or register first).
4. Call `veya_verify_transaction` on the returned `txHash`.
5. Optionally `veya_verify_commitment_onchain`.
6. Repeat with a **wrong** Bearer — the tool must error. Fail closed.

Public `mcp.veyanet.tech` should skip this procedure; writes should be off.

`scripts/verify-full.ts` in this repo is the operator automation for local user-vs-Bearer checks. It reads a relayer key from local `.env` and **must not print secrets**.

---

## 6. Repo scripts

| Command | What it checks |
|---------|----------------|
| `npm run smoke` | In-process `initialize`, `tools/list` (≥ 30 tools), `veya_describe`, `veya_ping_chain` |
| `npm test` | Unit tests (config, etc.) |
| `npm run lint` | `tsc --noEmit` |
| `tsx scripts/verify-full.ts` | Local MCP with optional writes (needs `.env` relayer) |
| `tsx scripts/verify-live.ts` | Live public endpoints (operator) |

Strangers can stop at Procedure A + explorer.

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
| Health chain id | `46630` |
| Describe sealed | AES-256-GCM |
| Ping chain id | `46630` |
| Known tx verify | Parses `Veya.sol` events; explorer agrees |
| Public writes | `writesEnabled: false` |
| Guest Build | 403 |
| Consensus with fleet down | `consensus_reached: false` or tool error |

Related: [AUTHENTICATION.md](./AUTHENTICATION.md) for Bearer tests.
