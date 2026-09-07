# SDK Bridge — VEYA MCP ↔ `@veyanet/sdk`

This document lists exactly what `@veyanet/mcp` imports from `@veyanet/sdk` and what it deliberately does not re-implement.

## Dependency

```json
"@veyanet/sdk": "file:../sdk"
```

Build the SDK before installing MCP:

```bash
cd ../sdk && npm install && npm run build
cd ../hosted-mcp && npm install
```

## Factories (`src/sdk.ts`)

| Helper | SDK usage |
|--------|-----------|
| `createReadClient(cfg)` | `new VeyaClient({ rpcUrl, contractAddress, chainId, explorerUrl })` — no payer |
| `createWriteClient(cfg)` | same + `payerPrivateKey: cfg.relayerPrivateKey` |
| `parseHexBytes` | local helper (not SDK) for tool hex args |

## Public tools → SDK methods

| MCP tool | SDK call |
|----------|----------|
| `veya_describe` | none (config honesty JSON) |
| `veya_ping_chain` | `client.pingChain()`, `client.describe()` |
| `veya_hash_blake3` | `client.hashBlake3(data)` |
| `veya_verify_transaction` | `client.verifyTransaction(txHash)` |
| `veya_api_health` | `fetch(apiUrl/health)` — not SDK |

## Write tools → SDK methods

| MCP tool | SDK call |
|----------|----------|
| `veya_store_commitment` | `client.requireEvm().storeCommitment(uuid16, commitment32)` |
| `veya_attest_execution` | `client.requireEvm().attestExecution(...)` |
| `veya_register_environment` | `client.requireEvm().registerEnvironment(...)` |

`EvmAnchor` enforces `ensureRobinhoodChain()` before submit.

## Not exposed via MCP (use SDK or product API)

* `runConsensus` / validator fleet orchestration
* `protectedExecute` / sealed-node AES session
* Kyber session establishment
* In-memory `recordLocalSpend` ledger
* Full product guest/wallet JWT auth
* `initSpendingLimit` / `recordSpend` / `flagMemoryNullifier` (backend request path; not currently MCP tools)

If you need those, import `@veyanet/sdk` in your own process or use the product API — do not assume MCP mirrors the entire SDK surface.

## Version alignment

MCP honesty and docs assume SDK **1.2.x** honesty (`SDK_SURFACE`: AES-256-GCM, not FHE, testnet 46630). After upgrading the SDK, re-run:

```bash
npm run lint && npm test && npm run smoke
```

## Why a bridge exists

Agents should not embed relayer keys. MCP lets them call read/verify tools over HTTPS. Operators who need full cryptographic control stay on the SDK.
