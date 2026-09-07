# Authentication & Writes — VEYA MCP

## Model summary

| Surface | Auth |
|---------|------|
| Public tools | None |
| `/health`, `/` | None |
| Write tools | `Authorization: Bearer <MCP_API_KEY>` **and** server-side relayer key |

There is no end-user wallet login inside this MCP process. Wallet / guest sessions belong to the product API and product-site.

## Enabling writes

Both must be set in the server environment:

```bash
MCP_API_KEY=...                # shared secret for callers
VEYA_RELAYER_PRIVATE_KEY=0x... # pays gas on Robinhood testnet
```

`VEYA_DEPLOYER_PRIVATE_KEY` is accepted as an alternate payer env name.

If either is missing, `writesEnabled(cfg)` is false:
* Write tools are **not** registered
* `veya_writes_status` is registered instead

## Bearer validation

`src/auth.ts`:

1. Extract `Authorization: Bearer …`
2. Require `cfg.mcpApiKey` to be set
3. Require bearer equality (constant-time string compare is not currently used; treat key as high entropy and rotate on suspicion)
4. Require relayer private key present

Failure throws; the tool call fails closed.

## Client example (conceptual)

MCP clients differ in how they attach HTTP headers. Operators testing with raw HTTP must send:

```http
POST /mcp HTTP/1.1
Host: mcp.veyanet.tech
Authorization: Bearer <MCP_API_KEY>
Content-Type: application/json
Accept: application/json, text/event-stream
```

If your Claude/Cursor build cannot attach custom headers, keep writes **disabled** on the public URL and run a separate private MCP instance for authorized writers.

## Key custody

| Secret | Where it lives | Never |
|--------|----------------|-------|
| `MCP_API_KEY` | Server `.env`, optionally CI secret store | README, git, screenshots |
| Relayer private key | Server `.env` only | Logs, tool responses, `/health` |
| User wallet keys | Not used by this MCP | — |

## Recommended production posture

1. Public `mcp.veyanet.tech` → **reads only** (`writesEnabled: false`)
2. Private operator instance (VPN / IP allowlist) → writes enabled with dedicated testnet wallet
3. Rotate `MCP_API_KEY` if any authorized client is compromised
4. Fund relayer with minimal testnet ETH; monitor explorer for unexpected txs

## Abuse considerations

Write tools can spend testnet gas and mutate protocol state (commitments, environments, attestations). Treat Bearer distribution like production API key distribution. Rate limiting at nginx is recommended before enabling public writes.

## Related

* [TOOLS.md](./TOOLS.md) — write tool argument lists
* [CONFIGURATION.md](./CONFIGURATION.md) — env names
* [../SECURITY.md](../SECURITY.md) — disclosure
