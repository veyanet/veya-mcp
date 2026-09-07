# System Architecture — VEYA MCP

## Purpose

`@veyanet/mcp` is a **thin Streamable HTTP gate** in front of `@veyanet/sdk`. It exists so agent clients can paste `https://mcp.veyanet.tech/mcp` and call selected VEYA capabilities without embedding the SDK. It is not a second cryptography stack and not a token service.

## Trust boundaries

```text
┌─────────────────────────────────────────────────────────────┐
│  MCP Client (Claude / Cursor / custom agent)                │
│  Trusts: TLS to mcp.veyanet.tech, tool JSON responses       │
│  Does not receive: relayer private keys, MCP_API_KEY dump   │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTPS Streamable HTTP
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  @veyanet/mcp process                                       │
│  Owns: POST /mcp, /health, tool registry, Bearer check      │
│  Does not own: PQ primitives, consensus quorum, sealed AES  │
└────────────────────────────┬────────────────────────────────┘
                             │ in-process import
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  @veyanet/sdk                                               │
│  Owns: BLAKE3, verify receipts, EvmAnchor, chain id guard   │
└────────────────────────────┬────────────────────────────────┘
                             │ JSON-RPC
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Robinhood Chain testnet 46630 · Veya.sol                   │
│  Owns: commitments, environments, attestations (protocol)   │
└─────────────────────────────────────────────────────────────┘

Optional side call:
  veya_api_health → https://api.veyanet.tech/health
  (product API fleet honesty; independent of MCP process uptime)
```

## Components inside this package

| Module | Role |
|--------|------|
| `src/http.ts` | Express app: `/`, `/health`, `POST /mcp`, optional session path |
| `src/server.ts` | `McpServer` construction + tool registration |
| `src/config.ts` | Env load, defaults, `writesEnabled` |
| `src/auth.ts` | Bearer extract + write assert |
| `src/sdk.ts` | Read/write `VeyaClient` factories |
| `src/tools/public.ts` | Public tools |
| `src/tools/write.ts` | Authenticated write tools |
| `scripts/smoke.ts` | Live initialize + tool smoke |

## What this architecture refuses

* Inventing 2-of-3 quorum inside MCP without validators
* Claiming FHE / SGX / Nitro as the sealed product path
* Claiming mainnet settlement before Phase 3
* Exposing write tools without both API key and relayer key
* Treating `Veya.sol` as ERC-20

## Relationship to stdio MCP

`veya-anchor/packages/mcp/` is a **local stdio** operator surface. `@veyanet/mcp` is the **HTTP** public surface. Both should stay honest about the same chain pins; they are not nested packages.

## Failure domains

| Domain | Symptom | Operator action |
|--------|---------|-----------------|
| MCP process down | Connector timeout | Restart Node / systemd |
| RPC down | `veya_ping_chain` / verify fail | Check Robinhood RPC |
| Product API degraded | `veya_api_health` body degraded | Fleet / SHIP.md — MCP can still serve describe/ping if RPC works |
| Wrong Bearer | Write tool error | Rotate / fix `MCP_API_KEY` |
| Chain mismatch | SDK `CHAIN_MISMATCH` on writes | Fix RPC / chain id env |

## Security notes

See [AUTHENTICATION.md](./AUTHENTICATION.md) and [../SECURITY.md](../SECURITY.md). Relayer keys are high value: use a dedicated testnet wallet, minimal ETH, and rotate if leaked.
