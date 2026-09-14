# Configuration Reference — `@veyanet/mcp`

How the Node process learns chain pins, API URL, fleet URLs, and write keys.

**Strangers do not configure this.** They paste `https://mcp.veyanet.tech/mcp`. This file is for people who **self-host** `@veyanet/mcp` or operate `mcp.veyanet.tech`.

Source of truth: `src/config.ts` (`loadConfig()`, `writesEnabled()`). Template: `.env.example`.

**[Architecture](./ARCHITECTURE.md)** • **[Authentication](./AUTHENTICATION.md)** • **[Network pin](./NETWORK_PIN.md)** • **[Deployment](./DEPLOYMENT.md)**

---

## Table of contents

1. [Audience](#1-audience)
2. [Resolution order](#2-resolution-order)
3. [What `loadConfig` returns](#3-what-loadconfig-returns)
4. [Variable catalog](#4-variable-catalog)
5. [Writes gate](#5-writes-gate)
6. [Fleet defaults (read this twice)](#6-fleet-defaults-read-this-twice)
7. [Comment-only line in `.env.example`](#7-comment-only-line-in-envexample)
8. [CORS](#8-cors)
9. [Misconfiguration patterns](#9-misconfiguration-patterns)
10. [Local operator example](#10-local-operator-example)

---

## 1. Audience

| You | Action |
|-----|--------|
| Claude/Cursor user | No env. Paste the public URL. |
| App developer | Configure `@veyanet/sdk`, not this file, unless you also run MCP. |
| MCP host operator | Copy `.env.example` → `.env` on the **server**. Never commit `.env`. |

Node **20+** (`package.json` `engines`).

---

## 2. Resolution order

1. `process.env` (including values loaded by your process manager; this package’s CLI does **not** auto-load `.env` — put env in the systemd/docker unit or export them).
2. Hard-coded **Robinhood testnet** defaults in `loadConfig()`.

There is no remote config service. There is no fetch of an IDL.

Scripts such as `scripts/verify-full.ts` may read `.env` themselves for a relayer key. The production binary `veya-mcp` does not.

---

## 3. What `loadConfig` returns

Type `McpServiceConfig`:

| Field | Comes from |
|-------|------------|
| `port` | `PORT` |
| `host` | `HOST` |
| `publicMcpUrl` | `PUBLIC_MCP_URL` (trailing slash stripped) |
| `chainId` | `ROBINHOOD_CHAIN_ID` |
| `rpcUrl` | `ROBINHOOD_RPC_URL` |
| `explorerUrl` | `ROBINHOOD_EXPLORER_URL` |
| `contractAddress` | `VEYA_CONTRACT_ADDRESS` |
| `apiUrl` | `VEYA_API_URL` (trailing slash stripped) |
| `mcpApiKey` | `MCP_API_KEY` or `null` |
| `relayerPrivateKey` | `VEYA_RELAYER_PRIVATE_KEY` or `VEYA_DEPLOYER_PRIVATE_KEY` or `null` |
| `validatorNodes` | CSV `VEYA_VALIDATOR_NODES` |
| `sealedNodeUrl` | `VEYA_SEALED_NODE_URL` |
| `corsOrigins` | CSV `CORS_ORIGIN` |
| `nodeEnv` | `NODE_ENV` |

`MCP_SERVICE_NAME` is `@veyanet/mcp`. `MCP_SERVICE_VERSION` is `1.1.0` (code constant, not read from env).

---

## 4. Variable catalog

### Process bind

| Variable | Type | Default | Notes |
|----------|------|---------|-------|
| `PORT` | number | `8788` | Reverse proxy forwards here |
| `HOST` | string | `0.0.0.0` | Bind address |
| `PUBLIC_MCP_URL` | URL | `https://mcp.veyanet.tech/mcp` | Landing/health advertisement. Keep this the **public** paste URL in production. |
| `NODE_ENV` | string | `development` | Use `production` on the public host |

### Settlement pins

Must match `@veyanet/sdk` defaults unless you are deliberately running a private fork.

| Variable | Type | Default |
|----------|------|---------|
| `ROBINHOOD_CHAIN_ID` | number | `46630` |
| `ROBINHOOD_RPC_URL` | URL | `https://rpc.testnet.chain.robinhood.com` |
| `ROBINHOOD_EXPLORER_URL` | URL | `https://explorer.testnet.chain.robinhood.com` |
| `VEYA_CONTRACT_ADDRESS` | address | `0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84` |

If you change chain id, change RPC, explorer, and contract **together**. SDK writes call `ensureRobinhoodChain()` and refuse a mismatched `eth_chainId`.

### Product API

| Variable | Type | Default |
|----------|------|---------|
| `VEYA_API_URL` | URL | `https://api.veyanet.tech` |

Used by `veya_api_health`, all `veya_public_*` and product session tools, and (indirectly) anything that needs hosted rooms. Consensus **capacity** is still the fleet URLs below; the API health endpoint reports whether that fleet is reachable on the **API** host.

### Fleet (this MCP process as HTTP client)

| Variable | Type | Default in code |
|----------|------|-----------------|
| `VEYA_VALIDATOR_NODES` | comma-separated URLs | `http://127.0.0.1:7701,http://127.0.0.1:7702,http://127.0.0.1:7703` |
| `VEYA_SEALED_NODE_URL` | URL | `http://127.0.0.1:7800` |

See [section 6](#6-fleet-defaults-read-this-twice).

### Write gate

| Variable | Type | Default |
|----------|------|---------|
| `MCP_API_KEY` | string | empty → writes disabled |
| `VEYA_RELAYER_PRIVATE_KEY` | `0x` hex secp256k1 | empty → writes disabled |
| `VEYA_DEPLOYER_PRIVATE_KEY` | `0x` hex | used only if relayer unset |

### CORS

| Variable | Type | Default |
|----------|------|---------|
| `CORS_ORIGIN` | comma-separated origins | empty |

Empty: browser Origins rejected; no-Origin MCP clients still work.

---

## 5. Writes gate

```ts
writesEnabled(cfg) === Boolean(cfg.mcpApiKey && cfg.relayerPrivateKey)
```

Both must be non-empty after trim. Then write tools register; callers still send `Authorization: Bearer <MCP_API_KEY>`.

Public host: leave both empty (or unset). See [AUTHENTICATION.md](./AUTHENTICATION.md).

---

## 6. Fleet defaults (read this twice)

The **code default** is loopback. That is for an MCP process that sits **on the same machine as validators** (typical when you run MCP next to the product API).

The **stranger path** is never those ports. Strangers only POST to `https://mcp.veyanet.tech/mcp`. The MCP host, if it is **not** on the API box, must set `VEYA_VALIDATOR_NODES` and `VEYA_SEALED_NODE_URL` to wherever the backend actually listens (private network). If those URLs are wrong or down:

- `veya_run_consensus` / `veya_sealed_execute` fail closed
- MCP does not invent a quorum hash

User-facing copy uses `https://mcp.veyanet.tech/mcp`. `.env.example` leaves fleet vars commented on purpose.

Production `/health` on **api.veyanet.tech** can be `degraded` when the fleet is not running there. That is honest API status, not an MCP config bug.

---

## 7. Comment-only line in `.env.example`

`.env.example` includes `ROBINHOOD_NETWORK=testnet`. `loadConfig()` uses chain id `46630`. That extra line is a human comment; the pin that matters is the chain id.

---

## 8. CORS

See [TRANSPORT.md](./TRANSPORT.md). `credentials: true` with an allowlist. MCP native clients usually send no Origin.

---

## 9. Misconfiguration patterns

| Mistake | Symptom |
|---------|---------|
| Wrong chain id / RPC | Writes `CHAIN_MISMATCH`; reads look like another network |
| `PUBLIC_MCP_URL` = private host in prod | Landing tells people the wrong paste URL (landing HTML currently **forces** the canonical public URL; health still uses `cfg.publicMcpUrl`) |
| Relayer set, no `MCP_API_KEY` | Writes stay disabled |
| `MCP_API_KEY` set, no relayer | Writes stay disabled |
| Documenting loopback as the product path | Users cannot reach your private network |
| Pointing fleet at empty loopback on a host without validators | Consensus/sealed fail — expected |
| Using guest JWT as `MCP_API_KEY` | Product and write auth confused |

Health `publicMcpUrl` follows env. Landing HTML uses `CANONICAL_PUBLIC_MCP_URL`. Keep them aligned: `PUBLIC_MCP_URL=https://mcp.veyanet.tech/mcp`.

---

## 10. Local operator example

```bash
cp .env.example .env
# edit .env on the machine only
export $(grep -v '^#' .env | xargs)   # or use your process manager
npm run build
node dist/cli.js
```

Then a **local** client can POST `http://127.0.0.1:8788/mcp`. That URL is for you, not for the world.

Related: [DEPLOYMENT.md](./DEPLOYMENT.md) for TLS.
