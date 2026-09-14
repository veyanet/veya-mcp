# Changelog

All notable changes to the `@veyanet/mcp` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-09-11

### Added
- Full public tool surface: PQ crypto, fleet/sealed/coordination, local memory, public registry + on-chain reads, product API session tools (guest login, environments, agents, proofs, Boundnet).
- On-chain write helpers: `veya_register_pq_onchain`, `veya_anchor_pq_attestation` (still Bearer + relayer gated).
- Config: `VEYA_VALIDATOR_NODES`, `VEYA_SEALED_NODE_URL` for server-side fleet (backend/API-owned in production).

### Changed
- Package is no longer a 6-tool teaser; auth tiers and fail-closed fleet/writes remain.
- Landing `GET /` redesigned: always advertises `https://mcp.veyanet.tech/mcp`.
- Docs rewritten for GitHub strangers: public MCP + `@veyanet/sdk` + `api.veyanet.tech` only. Consensus validators are backend/API-owned — no localhost user path.


## [1.0.0] — 2026-09-07

### Added
- **Canonical Package Release**: Official `@veyanet/mcp` Streamable HTTP Model Context Protocol server for VEYA on Robinhood Chain.
- **Public MCP URL**: Production paste endpoint `https://mcp.veyanet.tech/mcp` with landing `/` and honesty `/health`.
- **Public Tools**: `veya_describe`, `veya_ping_chain`, `veya_hash_blake3`, `veya_verify_transaction`, `veya_api_health`, and `veya_writes_status` when writes are disabled.
- **Authenticated Write Tools**: `veya_store_commitment`, `veya_attest_execution`, `veya_register_environment` gated by `MCP_API_KEY` + relayer private key and Bearer authorization.
- **SDK Bridge**: All chain crypto/verify/write paths delegate to `@veyanet/sdk` (`VeyaClient` / `EvmAnchor`) with chain id **46630** guards on writes.
- **Documentation Suite**: Publish-grade README (SDK-parity structure) plus `docs/` hub covering network pins, quickstart, architecture, tools, verification, deployment, configuration, transport, authentication, and SDK bridge.
- **Operator Scripts**: `npm test` (config + `/health` honesty) and `npm run smoke` (live initialize + tool calls).
- **Security Policy**: Coordinated disclosure via `security@veyanet.tech`; secrets hygiene for `.env` / Bearer / relayer keys.

### Security
- Fail-closed writes when keys unset or Bearer mismatches.
- Honesty fields refuse FHE / mainnet / ERC-20 claims.
- CORS allowlist for credentialed browser Origins; empty allowlist rejects unknown Origins.

### Notes
- Monorepo directory name `robinhood/hosted-mcp/` is layout-only next to the stdio MCP; the published product name is **VEYA MCP** / `@veyanet/mcp`.
- Stdio operator MCP remains `veya-anchor/packages/mcp/`.
