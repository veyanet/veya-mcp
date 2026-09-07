<div align="center">

  # VEYA MCP | Security Policy

  **Coordinated disclosure for `@veyanet/mcp` on Robinhood Chain.**

  **[README](./README.md)** • **[Authentication](./docs/AUTHENTICATION.md)** • **[Architecture](./docs/ARCHITECTURE.md)** • **[SDK Security](../sdk/SECURITY.md)**

</div>

---

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x | Yes |

---

## Secrets that must never be published

| Secret | Storage |
|--------|---------|
| `.env` | Server only (gitignored) |
| `MCP_API_KEY` | Server env / secret manager |
| `VEYA_RELAYER_PRIVATE_KEY` | Server env / secret manager |
| `VEYA_DEPLOYER_PRIVATE_KEY` | Server env / secret manager |

`.env.example` is the only environment template that belongs in git. It must not contain real keys.

---

## In-scope vulnerability classes

* Bypass of Bearer write gate (unauthenticated `storeCommitment` / `attestExecution` / `registerEnvironment`)
* Leakage of relayer private key or `MCP_API_KEY` via tool output, logs, or `/health`
* CORS misconfiguration that exfiltrates credentialed browser sessions (if any)
* Chain settlement against a mismatched chain id when writes are enabled
* Honesty violations that cause clients to believe FHE / mainnet / ERC-20 are live

## Out of scope (report to the right component)

* Product API JWT / guest auth bugs → backend
* SDK cryptographic implementation bugs → `@veyanet/sdk` (still welcome via the same email; identify the package)
* Robinhood Chain infrastructure outages

---

## Reporting a vulnerability

Do not open public GitHub issues for security vulnerabilities.

Report privately to **security@veyanet.tech**.

Include:
* Summary and impact
* Component (`@veyanet/mcp` transport, auth, specific tool)
* Reproduction against `mcp.veyanet.tech` or a local build
* Node version and whether writes were enabled

Acknowledgment target: 72 hours. Coordinated disclosure before public detail appears in [CHANGELOG.md](./CHANGELOG.md).

---

## Operator hardening checklist

* Prefer read-only public MCP; private instance for writes
* `chmod 600` on `.env`
* Forward `Authorization` through TLS proxy
* Monitor explorer for unexpected relayer txs
* Rotate Bearer and relayer key on suspicion
