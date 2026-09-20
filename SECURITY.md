<div align="center">

# VEYA MCP | Security Policy

**Coordinated disclosure for `@veyanet/mcp` on Robinhood Chain testnet.**

**[README](./README.md)** • **[Authentication](./docs/AUTHENTICATION.md)** • **[Architecture](./docs/ARCHITECTURE.md)** • **[SDK Security](https://github.com/veyanet/veya-sdk/blob/main/SECURITY.md)**

</div>

---

## Table of contents

1. [Supported versions](#supported-versions)
2. [Secrets](#secrets)
3. [Trust model (short)](#trust-model-short)
4. [In-scope vulnerability classes](#in-scope-vulnerability-classes)
5. [Related components](#related-components)
6. [Reporting a vulnerability](#reporting-a-vulnerability)
7. [Operator hardening checklist](#operator-hardening-checklist)

---

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.2.x | Yes |
| 1.1.x | Yes |

npm package: `@veyanet/mcp`. Public host: `https://mcp.veyanet.tech/mcp`.

---

## Secrets

| Secret | Storage |
|--------|---------|
| `.env` | Server only (gitignored) |
| Product `apiKey` | Tool argument; forwarded as `X-Api-Key` |
| `VEYA_PAYER_PRIVATE_KEY` | Self-hosted env / secret manager (preferred) |
| `payerPrivateKey` tool arg | Caller custody — testnet only; prefer env |
| ML-DSA private keys from `veya_pq_keygen` | Caller custody — not logs, not git |

`.env.example` is the only environment template that belongs in git. It must not contain real keys.

`/health`, landing HTML, and `veya_describe` must never print keys or validator admin credentials.

Guest JWTs are product-API sessions. Do not treat them as unique human accounts. Do not put them in git.

---

## Trust model (short)

- Public tools have **no** key. That is intentional. Chain **writes** must still fail without a product `apiKey` and a funded user `payerPrivateKey`.
- Product `apiKey` is a **different** secret from a guest JWT. Mixing them is a configuration bug.
- Guest JWT is listing-only from MCP.
- Fleet URLs default to loopback so a colocated process can reach validators. Those ports must **not** be on the public firewall.
- Sealed execution is **AES-256-GCM**. Honesty bugs that claim otherwise are in-scope as misleading security statements.
- `Veya.sol` is a protocol contract. Docs that invent a token address are in-scope as honesty violations.

Details: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), [docs/AUTHENTICATION.md](./docs/AUTHENTICATION.md).

---

## In-scope vulnerability classes

Report these against `@veyanet/mcp`:

- Bypass of the product-key write gate (on-chain write without a `veya_dev_` / `veya_live_` key)
- On-chain write that spends a hosted relayer when the caller used a product API key (user must be `msg.sender`)
- Leakage of `payerPrivateKey` or `apiKey` via tool output, logs, `/health`, or landing HTML
- CORS misconfiguration that exfiltrates credentialed browser sessions
- Chain settlement against a mismatched chain id when writes are enabled (MCP failing to use SDK `ensureRobinhoodChain` / wrong pins)
- Honesty violations that cause clients to believe FHE, mainnet, or ERC-20 are live
- SSRF-style abuse if a tool forwards unsanitized URLs from callers into the MCP host’s network in a way that was not intended (custom `nodeUrls` / `sealedNodeUrl` on fleet tools — treat unexpected reachability as in-scope)

---

## Related components

Report to the right component (same email is fine if you label the package):

| Issue | Component |
|-------|-----------|
| Product API JWT / guest 403 policy | Backend (`api.veyanet.tech`) |
| SDK cryptographic implementation | `@veyanet/sdk` |
| Robinhood Chain outages | Chain operator |
| “Validators down so consensus failed” | Expected fail-closed, not a vuln |
| Guest cannot Build | Product policy |

---

## Reporting a vulnerability

Do not open public GitHub issues for security vulnerabilities.

Report privately to **security@veyanet.tech**.

Include:

- Summary and impact
- Component (`@veyanet/mcp` transport, auth, specific tool)
- Reproduction against `https://mcp.veyanet.tech` or a local build
- Node version and whether writes were enabled
- Whether any key material was exposed (rotate immediately if yes)

Acknowledgment target: **72 hours**. Coordinated disclosure before public detail appears in [CHANGELOG.md](./CHANGELOG.md).

---

## Operator hardening checklist

- Public MCP serves free reads plus user-paid writes (product `apiKey` + user wallet). Do not enable a hosted relayer on the public URL
- `chmod 600` on `.env`
- Do not expose `7701–7703` / `7800` on the public internet
- Monitor the explorer for unexpected txs from **user** wallets that called this host
- Rotate product API keys and payer keys on suspicion
- Keep `PUBLIC_MCP_URL=https://mcp.veyanet.tech/mcp` so humans are never told to paste a private bind
- JSON body cap is 1 MB — keep proxy limits aligned; rate-limit `/mcp` at the edge
- Prefer self-host for `VEYA_PAYER_PRIVATE_KEY` instead of sending a private key to the public URL
