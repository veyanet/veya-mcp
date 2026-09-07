# Configuration Reference — VEYA MCP

How `@veyanet/mcp` resolves runtime configuration. Source of truth: `src/config.ts`.

## Resolution order

1. Process environment variables (including values loaded from `.env` by your process manager)
2. Hard-coded Robinhood **testnet** defaults in `loadConfig()`

There is no separate config file format. Operators use `.env` on the host; the repository only ships `.env.example`.

## Variable catalog

### Process bind

| Variable | Type | Default | Notes |
|----------|------|---------|-------|
| `PORT` | number | `8788` | nginx should proxy here |
| `HOST` | string | `0.0.0.0` | use `127.0.0.1` only if nginx is local and you want bind lockdown |
| `PUBLIC_MCP_URL` | URL | `https://mcp.veyanet.tech/mcp` | Trailing slash stripped; shown on landing + health |
| `NODE_ENV` | string | `development` | use `production` on the public host |

### Settlement pins

| Variable | Type | Default |
|----------|------|---------|
| `ROBINHOOD_NETWORK` | string | documented in `.env.example` as `testnet` (informational) |
| `ROBINHOOD_CHAIN_ID` | number | `46630` |
| `ROBINHOOD_RPC_URL` | URL | `https://rpc.testnet.chain.robinhood.com` |
| `ROBINHOOD_EXPLORER_URL` | URL | `https://explorer.testnet.chain.robinhood.com` |
| `VEYA_CONTRACT_ADDRESS` | address | `0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84` |

### Product API

| Variable | Type | Default |
|----------|------|---------|
| `VEYA_API_URL` | URL | `https://api.veyanet.tech` |

Used only by `veya_api_health` (trailing slash stripped).

### Write gate

| Variable | Type | Default |
|----------|------|---------|
| `MCP_API_KEY` | string | empty → writes disabled |
| `VEYA_RELAYER_PRIVATE_KEY` | `0x` hex key | empty → writes disabled |
| `VEYA_DEPLOYER_PRIVATE_KEY` | `0x` hex key | fallback if relayer unset |

`writesEnabled` is true only when **both** an API key and a payer key resolve.

### CORS

| Variable | Type | Default |
|----------|------|---------|
| `CORS_ORIGIN` | comma-separated origins | empty |

Empty allowlist: credentialed browser Origins are rejected. Requests with no `Origin` (typical MCP connectors) still work.

## Derived helpers

```typescript
import { loadConfig, writesEnabled, MCP_SERVICE_NAME, MCP_SERVICE_VERSION } from "@veyanet/mcp";

const cfg = loadConfig();
writesEnabled(cfg); // boolean
```

## Local `.env` hygiene

```bash
cp .env.example .env
chmod 600 .env
# never git add .env
```

`.gitignore` already excludes `.env`.

## Misconfiguration patterns

| Mistake | Symptom |
|---------|---------|
| Wrong chain id alone | Writes fail `CHAIN_MISMATCH`; reads may look “fine” on wrong network data |
| `PUBLIC_MCP_URL` still localhost in prod | Landing/health advertise wrong paste URL |
| Write key set without `MCP_API_KEY` | Writes stay disabled |
| `MCP_API_KEY` set without relayer | Writes stay disabled |
| Forgetting nginx `Authorization` forward | Bearer never reaches Node; writes always unauthorized |

See also [NETWORK_PIN.md](./NETWORK_PIN.md) and [AUTHENTICATION.md](./AUTHENTICATION.md).
