# Configuration Reference — `@veyanet/mcp`

How the Node process learns chain pins, API URL, fleet URLs, and write keys.

**Public users do not configure this.** They paste `https://mcp.veyanet.tech/mcp`. This file is for people who **self-host** `@veyanet/mcp` or operate `mcp.veyanet.tech`.

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
11. [Metered Call Guard](#11-metered-call-guard)

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
2. Hard-coded **Mainnet** defaults in `loadConfig()`. `ROBINHOOD_NETWORK=testnet` selects Testnet.

There is no remote config service. There is no fetch of an IDL.

Scripts such as `scripts/verify-full.ts` may read `.env` themselves for a test payer key. The production binary `veya-mcp` does not.

---

## 3. What `loadConfig` returns

Type `McpServiceConfig`:

| Field | Comes from |
|-------|------------|
| `port` | `PORT` |
| `host` | `HOST` |
| `publicMcpUrl` | `PUBLIC_MCP_URL` (trailing slash stripped) |
| `network` | `ROBINHOOD_NETWORK`. Unset is Mainnet. `testnet` is Testnet |
| `chainId` | The selected profile. See [NETWORK_PIN.md](./NETWORK_PIN.md) |
| `rpcUrl` | Mainnet or Testnet RPC for that profile |
| `explorerUrl` | Mainnet or Testnet explorer for that profile |
| `contractAddress` | Mainnet protocol contract, or the Testnet contract when Testnet is selected |
| `apiUrl` | `VEYA_API_URL` (trailing slash stripped) |
| `mcpApiKey` | `MCP_API_KEY` or `null`. When set, `/mcp` requires this Bearer token |
| `relayerPrivateKey` | Mainnet: `VEYA_MAINNET_RELAYER_PRIVATE_KEY`. Testnet: `VEYA_RELAYER_PRIVATE_KEY`, else `VEYA_DEPLOYER_PRIVATE_KEY`. Otherwise `null` (not used for own-wallet writes) |
| `payerPrivateKey` | `VEYA_PAYER_PRIVATE_KEY` or `null` (your wallet for own-wallet writes) |
| `validatorNodes` | CSV `VEYA_VALIDATOR_NODES` |
| `sealedNodeUrl` | `VEYA_SEALED_NODE_URL` |
| `corsOrigins` | CSV `CORS_ORIGIN` |
| `nodeEnv` | `NODE_ENV` |

`MCP_SERVICE_NAME` is `@veyanet/mcp`. `MCP_SERVICE_VERSION` is `1.2.11` (read from `package.json`, not from env).

---

## 4. Variable catalog

### Process bind

| Variable | Type | Default | Notes |
|----------|------|---------|-------|
| `PORT` | number | `<mcp-port>` | Reverse proxy forwards here |
| `HOST` | string | `0.0.0.0` | Bind address |
| `PUBLIC_MCP_URL` | URL | `https://mcp.veyanet.tech/mcp` | Landing/health advertisement. Keep this the **public** paste URL in production. |
| `NODE_ENV` | string | `development` | Use `production` on the public host |

### Settlement pins

Must match `@veyanet/sdk` defaults unless you are deliberately running a private fork.

| Variable | Type | Default |
|----------|------|---------|
| `ROBINHOOD_NETWORK` | `mainnet` or `testnet` | Mainnet |
| `ROBINHOOD_MAINNET_CHAIN_ID` | number | Mainnet profile |
| `ROBINHOOD_MAINNET_RPC_URL` | URL | `https://rpc.mainnet.chain.robinhood.com` |
| `ROBINHOOD_MAINNET_EXPLORER_URL` | URL | `https://robinhoodchain.blockscout.com` |
| `VEYA_MAINNET_CONTRACT_ADDRESS` | address | Mainnet protocol contract. An explicit empty string stays unpublished |
| `VEYA_MAINNET_RELAYER_PRIVATE_KEY` | `0x` hex | Mainnet host signer key for `veya_seal_decision` when the host signer switch is on |
| `VEYA_SEAL_DECISION_ENVIRONMENT_ID` | uuid | Required for `veya_seal_decision` on Mainnet. Testnet uses the SDK environment when this is unset |
| `VEYA_CONTRACT_ADDRESS` | address | Testnet contract, used only when the profile is Testnet |

RPC, explorer, and contract move together with the profile. SDK writes refuse a mismatched RPC. The numeric pins are in [NETWORK_PIN.md](./NETWORK_PIN.md).

### Product API

| Variable | Type | Default |
|----------|------|---------|
| `VEYA_API_URL` | URL | `https://api.veyanet.tech` |

Used by `veya_api_health`, all `veya_public_*` and product session tools, and (indirectly) anything that needs hosted rooms. Consensus **capacity** is still the fleet URLs below; the API health endpoint reports whether that fleet is reachable on the **API** host.

### Fleet (this MCP process as HTTP client)

| Variable | Type | Default in code |
|----------|------|-----------------|
| `VEYA_VALIDATOR_NODES` | comma-separated URLs | `<validator-1-url>,<validator-2-url>,<validator-3-url>` |
| `VEYA_SEALED_NODE_URL` | URL | `<sealed-node-url>` |

See [section 6](#6-fleet-defaults-read-this-twice).

### Own-wallet writes

| Variable | Type | Default |
|----------|------|---------|
| `VEYA_PAYER_PRIVATE_KEY` | `0x` hex secp256k1 | empty → pass `payerPrivateKey` per tool call |

On-chain writes always use **this** key (or the tool argument). `msg.sender` is your address. The hosted signer is not the gas payer.

### Operator signer (not the user path)

| Variable | Type | Default |
|----------|------|---------|
| `MCP_API_KEY` | string | When set, `/mcp` requires `Authorization: Bearer`. Empty leaves the public paste URL open |
| `VEYA_RELAYER_PRIVATE_KEY` | `0x` hex | empty. Testnet only. On Mainnet the host signer key is `VEYA_MAINNET_RELAYER_PRIVATE_KEY` |
| `VEYA_SEAL_DECISION_RELAYER` | `1` or `true` | off. Lets `veya_seal_decision` use the host signer key of the selected network (`VEYA_MAINNET_RELAYER_PRIVATE_KEY` on Mainnet) |
| `VEYA_SEAL_DECISION_DAILY_CAP` | number | `20` host-signer seal decisions per API key per UTC day |
| `VEYA_SEAL_DECISION_GLOBAL_DAILY_CAP` | number | `100` host-signer seal decisions per UTC day, all keys |
| `VEYA_CAPACITY_PER_MINUTE` | number | `30` calls per API key per minute on the fleet and `veya_seal_decision` tools |

### CORS

| Variable | Type | Default |
|----------|------|---------|
| `CORS_ORIGIN` | comma-separated origins | empty |

Empty: browser Origins rejected; no-Origin MCP clients still work.

---

## 5. Writes gate

```ts
writesEnabled() === true
operatorRelayerWritesEnabled() === false
```

Own-wallet write tools are **always registered**. They need a product `apiKey` and `VEYA_PAYER_PRIVATE_KEY` (or the tool argument). The host signer is not used. See [AUTHENTICATION.md](./AUTHENTICATION.md).

---

## 6. Fleet defaults (read this twice)

The **code default** is loopback. That is for an MCP process that sits **on the same machine as validators** (typical when you run MCP next to the product API).

The **public path** is never those ports. Public users only POST to `https://mcp.veyanet.tech/mcp`. The MCP host, if it is **not** on the API box, must set `VEYA_VALIDATOR_NODES` and `VEYA_SEALED_NODE_URL` to wherever the backend actually listens (private network). If those URLs are wrong or down:

- `veya_run_consensus` / `veya_sealed_execute` fail closed
- Consensus results come only from validator responses

User-facing copy uses `https://mcp.veyanet.tech/mcp`. `.env.example` leaves fleet vars commented on purpose.

Production /health on api.veyanet.tech shows fleet status.

---

## 7. Comment-only line in `.env.example`

`ROBINHOOD_NETWORK=testnet` selects Testnet. Leave it unset for Mainnet. That variable is the profile switch. It is not a comment.

---

## 8. CORS

See [TRANSPORT.md](./TRANSPORT.md). `credentials: true` with an allowlist. MCP native clients usually send no Origin.

---

## 9. Misconfiguration patterns

| Mistake | Symptom |
|---------|---------|
| Wrong chain id / RPC | Writes `CHAIN_MISMATCH`; reads look like another network |
| `PUBLIC_MCP_URL` = private host in prod | Landing tells people the wrong paste URL (landing HTML currently **forces** the canonical public URL; health still uses `cfg.publicMcpUrl`) |
| Host signer key set, `VEYA_SEAL_DECISION_RELAYER` unset | Seal-decision host signer stays off (own-wallet writes still work) |
| `MCP_API_KEY` set | `/mcp` requires that Bearer token. Host-signer writes stay off unless `VEYA_SEAL_DECISION_RELAYER=1` |
| Empty `VEYA_PAYER_PRIVATE_KEY` and no tool arg | `payerPrivateKey required` |
| Unfunded payer | Mainnet: `Your wallet has no ETH on Robinhood Chain. Add funds and try again.` Testnet: `You don't have testnet tokens. Please get them for the transaction.` |
| Documenting loopback as the product path | Users cannot reach your private network |
| Pointing fleet at empty loopback on a host without validators | Consensus/sealed fail — expected |
| Using guest JWT as `apiKey` on a write | MCP refuses; mint a product key |

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

Then a **local** client can POST `<your-mcp-host>/mcp`. That URL is for you, not for the world.

Related: [DEPLOYMENT.md](./DEPLOYMENT.md) for TLS.

---

## 11. Metered Call Guard

Opt-in. Nothing below is read unless `VEYA_PAID_CALLS=1`. Guide: [PAID_CALLS.md](./PAID_CALLS.md).

### Env vars

| Variable | Type | Default |
|----------|------|---------|
| `VEYA_PAID_CALLS` | `1` to enable | off |
| `VEYA_PAID_ROOT` | path | the package's parent folder (holds `state/`, `receipts/`, optional `config/`) |
| `VEYA_PAID_CONFIG` | path | `<root>/config/paid-calls.json` if present, else the copy shipped in the package |
| `VEYA_PAID_STATE_DIR` | path | `<root>/state` |
| `VEYA_PAID_RECEIPTS_DIR` | path | `<root>/receipts` |
| `VEYA_API_URL` | URL | the VEYA API; checks each `apiKey` and stores runs (`/v1/paid-runs`) |
| `VEYA_PAID_RECEIPTS_BASE_URL` | URL | unset = replies show the relative route `/receipts/paid/<runId>` |
| `VEYA_PAID_VALIDATOR_NODES` | CSV of URLs | from the config file (required with the shipped config) |
| `VEYA_PAID_CALLS_DISABLED` | `1` = kill switch | off |
| `VEYA_PAID_SPONSORED_KEYS` | `<apiKeyId>:<limitUsdc>[:<YYYY-MM-DD>]`, comma-separated | empty. Key ids only, never full keys. When set, the listed key ids may run calls on the server's own wallets up to their USDC limit, and the wallet-key arguments become optional in the tool schema |
| `VEYA_PAID_SOLANA_KEY_PATH` | path to a Solana keypair file | unset. Server Solana payer, used only for the key ids in `VEYA_PAID_SPONSORED_KEYS` |
| `VEYA_PAID_ANCHOR_KEY_PATH` | path to a Robinhood Chain key file | unset. Server anchor key for those runs. Kept apart from the host signer key so no other tool gains write power |

Callers bring their own keys as tool arguments (`solanaPrivateKey`, `robinhoodPrivateKey`), used in memory for that call only. With `VEYA_PAID_SPONSORED_KEYS` empty the server needs no wallet for metered calls.

One MCP process per state folder (`ledger.lock`). A second process on the same folder gets `STATE_LOCKED`.

### Config file (`config/paid-calls.json`)

| Field | Meaning |
|-------|---------|
| `enabled` | `false` blocks every metered call. |
| `recordVersion` | Version tag inside each anchored commitment record. |
| `providers[]` | `id`, `label`, default `payer` (`xpay-sdk` or `x402-exact`). `xpay-sdk` providers also carry `sdk.platformFee` and `sdk.guardrail`. |
| `resources[]` | `id`, `provider`, optional `payer` override, `url`, `method`, `input` (`required`, `optional`, `properties` with kinds `solana-address`, `slug`, `string`), `expectedResult`, and the pinned `x402` requirement (`scheme`, `network`, `asset`, `payTo`, `amount`, `feePayer`, `maxTimeoutSeconds`). |
| `policy` | `allowedTools`, `allowedHosts`, `allowedNetworks`, `allowedAssets`, `allowedPayees`, `perCallCapAtomic`, `taskBudgetAtomic`, `approvalThresholdAtomic`, `maxCallsPerTask`. |
| `solana` | Payer address, `commitment` (must be `finalized`), RPC list, explorer. |
| `robinhood` | RPC, contract, environment UUID and explorer used for anchoring. |
| `validators` | Node URLs, `threshold` (at least 2 of at least 3), and one Solana RPC per node from different providers. |

The loader refuses a config with an unknown provider or payer path, an `xpay-sdk` provider without `sdk` settings, a non-`exact` pin, fewer than three validators, validators that share an RPC provider, or a commitment other than `finalized`.
