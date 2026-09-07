# Verification Guide — VEYA MCP

How a stranger or auditor proves that MCP is talking to real Robinhood Chain settlement — without trusting marketing copy.

## Goal

Prove three facts:

1. The MCP endpoint is alive and honest (`/health`, `veya_describe`).
2. RPC chain id is **46630**.
3. A known (or newly written) commitment exists as a `Veya.sol` event and/or mapping.

## Procedure A — Public read verification (no keys)

### A1. Health

```bash
curl -s https://mcp.veyanet.tech/health
```

Require:
* `service` = `@veyanet/mcp`
* `chainId` = `46630`
* `sealed` contains `AES-256-GCM`
* `publicMcpUrl` = `https://mcp.veyanet.tech/mcp` (or your documented URL)

### A2. Describe via MCP client

Connect Streamable HTTP to `https://mcp.veyanet.tech/mcp` and call `veya_describe`. Cross-check contract address against [NETWORK_PIN.md](./NETWORK_PIN.md).

### A3. Ping

Call `veya_ping_chain`. Confirm chain id string matches `46630`.

### A4. Verify transaction

Call `veya_verify_transaction` with:

```text
0xd68ab19671f0a3be63651cb6d6e24f5decf591da981708502827bca3689d31d8
```

Open the explorer URL from the tool result. Confirm the transaction targets `Veya.sol` and the event digest matches the tool output.

### A5. Optional independent SDK check

From `robinhood/sdk`:

```bash
npm run example:verify
# or
npx tsx examples/verify-commitment.ts <txHash>
```

This uses the same settlement pins and can `eth_call` `commitments(digest)`.

## Procedure B — Operator write verification (keys required)

1. Enable writes on a **non-public** or tightly controlled instance first.
2. Call `veya_hash_blake3` to produce a 32-byte digest.
3. Call `veya_store_commitment` with Bearer auth and a registered environment UUID.
4. Call `veya_verify_transaction` on the returned `txHash`.
5. Optionally re-check with SDK `verifyCommitmentOnChain`.

If Bearer is wrong, the tool must fail. If keys are unset, write tools must not be available as an open surface.

## What verification does not prove

* That sealed-node AES ciphertext for some other workload is correct (different component).
* That product API guest JWT auth is correct (different component).
* That mainnet exists for VEYA (it is not claimed).

## Evidence pack for diligence

| Artifact | Source |
|----------|--------|
| `/health` JSON | curl |
| `veya_describe` JSON | MCP client |
| Explorer tx link | tool `explorer` field |
| SDK verify output | `npm run example:verify` |
| Package version | `package.json` / health `version` |
