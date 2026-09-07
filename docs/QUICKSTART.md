# Quickstart Guide — VEYA MCP

This guide takes a stranger from zero to a verified chain ping, then a developer from clone to smoke green. It mirrors the “first success” role of the SDK quickstart, but for Streamable HTTP MCP.

## Part 1 — Stranger (no code, no keys)

### Step 1 — Add the MCP URL

In Claude or Cursor, add a custom MCP connector with **Streamable HTTP** transport:

```text
https://mcp.veyanet.tech/mcp
```

### Step 2 — Honesty card

Ask the agent:

> Call `veya_describe` and summarize settlement and sealed claims.

You should see:
* `@veyanet/mcp`
* chain id **46630**
* `Veya.sol` address
* sealed = **AES-256-GCM** (not FHE)
* mainnet deferred

### Step 3 — Live chain ping

> Call `veya_ping_chain`.

Confirm `expectedChainId` / chain id is **46630** and a recent block number appears.

### Step 4 — Verify a transaction

> Call `veya_verify_transaction` with tx  
> `0xd68ab19671f0a3be63651cb6d6e24f5decf591da981708502827bca3689d31d8`

Expect a parsed Veya event (e.g. `CommitmentStored`) and digest hex. Cross-check the hash on the Robinhood testnet explorer.

### Step 5 — Optional API health

> Call `veya_api_health`.

The product API may return `degraded` if validators/sealed are down. That is honest status from `api.veyanet.tech`, not a requirement that MCP itself is broken.

---

## Part 2 — Developer (local)

### Prerequisites
* Node.js ≥ 20
* Network access to Robinhood testnet RPC

### Install and run

```bash
cd robinhood/sdk
npm install
npm run build

cd ../hosted-mcp
npm install
npm run build
cp .env.example .env
npm start
```

Local paste URL:

```text
http://127.0.0.1:8788/mcp
```

```bash
claude mcp add veya-local --transport http http://127.0.0.1:8788/mcp
```

### Verify locally

```bash
npm run lint
npm test
npm run smoke
curl -s http://127.0.0.1:8788/health
```

Smoke must print `PASS` after `veya_describe` and `veya_ping_chain`.

---

## Part 3 — Operator writes (optional)

Only if you intend authenticated on-chain tools on testnet:

1. Generate a long random `MCP_API_KEY`.
2. Fund a Robinhood **testnet** key; set `VEYA_RELAYER_PRIVATE_KEY`.
3. Restart; `/health` must show `"writesEnabled": true`.
4. Call write tools only with `Authorization: Bearer <MCP_API_KEY>`.
5. Confirm returned `txHash` on the explorer.

Do not enable writes on a public server without rate limits, key rotation, and a dedicated relayer wallet.

---

## Next reading

* [TOOLS.md](./TOOLS.md) — full argument lists
* [VERIFICATION.md](./VERIFICATION.md) — audit-grade verify path
* [DEPLOYMENT.md](./DEPLOYMENT.md) — `mcp.veyanet.tech` TLS
* [AUTHENTICATION.md](./AUTHENTICATION.md) — Bearer model
