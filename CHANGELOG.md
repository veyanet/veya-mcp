# Changelog

All notable changes to the `@veyanet/mcp` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.8] — 2026-10-17

### Fixed (launch)
- `veya_run_protected_execution` sends `discloseFields` / `sealFields`; sealed values are stored only as AES-256-GCM ciphertext.
- `veya_anchor_proof` confirms the anchor with the product API, so `veya_list_proofs` lists it (`recorded: true|false`).
- `veya_seal_decision` always returns `sealed.transaction` when a receipt exists.
- `veya_verify_transaction` returns `{ ok: false, code: "NOT_VEYA_TX" }` or `INVALID_TX_HASH` instead of `null`.
- `/health` and `/healthz` show validator counts and quorum only. Info pages at `/` and `/mcp` with API key steps and FAQ.
- Service version, health `version`, and `veya_describe` report **1.2.8** (read from `package.json`).
- Depends on `@veyanet/sdk` ^1.2.8 (Mainnet default). Publish the SDK first.

## [Unreleased → 1.2.8]

### Added
- Mainnet is the default profile when `ROBINHOOD_NETWORK` is unset. Settlement uses the protocol contract `0x87dC582eEA544A434a5C1e30Ca3d12c1e548a674`. The Mainnet payer slot is `VEYA_MAINNET_RELAYER_PRIVATE_KEY` only.
- Health and `veya_describe` report the profile the process actually selected.
- Sealed execution is described as **AES-256-GCM**.

### Changed
- `ROBINHOOD_NETWORK=testnet` keeps Testnet and `0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84`. Any other value, including an unset variable, resolves to Mainnet.
- An explicit empty Mainnet contract still returns `MAINNET_UNPUBLISHED` and sends nothing.
- `.env.example` keeps `ROBINHOOD_NETWORK=testnet` on purpose, with a comment, so copying that file cannot move a running host. The product API stays `https://api.veyanet.tech` and the paste URL stays `https://mcp.veyanet.tech/mcp`. Fleet URLs stay commented out.
- Service version matches `@veyanet/sdk`. This source selects the profile from the environment. Per-call `network` on tools lives in the hosted MCP tree.

### Fixed
- A process with no `ROBINHOOD_NETWORK` no longer stays on Testnet.

---

## [1.2.7] — 2026-10-02

### Added
- `ROBINHOOD_NETWORK=mainnet` selects the guard profile:, mainnet RPC, mainnet explorer, and `VEYA_MAINNET_RELAYER_PRIVATE_KEY` only. The testnet relayer key is not read on that profile. Default stays testnet. An explicit empty contract still sends nothing. The deployed address is recorded in Unreleased above.
- `veya_seal_decision`: an evidence id and a decision JSON object. The sealed runtime runs first. If it does not answer, the tool returns `SEALED_UNREACHABLE` and sends nothing. If it answers, a 2-of-3 ML-DSA quorum follows. `attestExecution` is sent when the call passes `payerPrivateKey`, or when `VEYA_SEAL_DECISION_RELAYER=1` and the host holds `VEYA_RELAYER_PRIVATE_KEY`. With that switch off and no payer key, the sealed result and the quorum are returned and nothing is sent. A refusal sets MCP `isError`.
- Depends on `@veyanet/sdk` ^1.2.8 for that call.
- Service version, health `version`, and `veya_describe` report **1.2.7**.

---

## [1.2.6] — 2026-10-02

### Added
- Mainnet profile when `ROBINHOOD_NETWORK=mainnet`:, mainnet RPC, mainnet explorer. The host reads `VEYA_MAINNET_RELAYER_PRIVATE_KEY` only. The protocol address landed later; see Unreleased.
- `veya_seal_decision` passes that profile through. An explicit empty contract returns `MAINNET_UNPUBLISHED` and sends nothing.
- Depends on `@veyanet/sdk` ^1.2.7.
- Service version, health `version`, and `veya_describe` report **1.2.6**.

---

## [1.2.5] — 2026-10-02

### Added
- `veya_seal_decision` first landed here, with the sealed runtime before any receipt and `SEALED_UNREACHABLE` when the sealed node does not answer.
- Depends on `@veyanet/sdk` ^1.2.6.
- Service version, health `version`, and `veya_describe` report **1.2.5**.

---

## [1.2.4] — 2026-10-01

### Added
- A receipt that called a different contract returns the full proof object. `refusal` is `transaction did not target Veya.sol — not a VEYA proof`.
- Service version, health `version`, and `veya_describe` report **1.2.4**.

---

## [1.2.3] — 2026-09-30

### Added
- `veya_prove`: text, canonical JSON, or a receipt hash in, one proof object out. A receipt with no VEYA log is a refusal. Without `anchor`, the result is the digest and `anchored` is false. Anchor writes one commitment only when `payerPrivateKey` and an existing `environmentId` are both passed, then reads that transaction back. Anchor without a payer key is a refusal. Neither of those sends a transaction. A refusal sets MCP `isError`.
- Depends on `@veyanet/sdk` ^1.2.4 for that proof object.
- Service version, health `version`, and `veya_describe` report **1.2.3**.

---

## [1.2.2] — 2026-09-29

### Changed
- Service version, health `version`, and `veya_describe` report **1.2.2**.
- Robinhood testnet chain hex is pinned in the profile.
- Depends on `@veyanet/sdk` ^1.2.3.

---

## [1.2.1] — 2026-09-20

### Added
- Product API client (`src/api.ts`) for session tools against `https://api.veyanet.tech` with `X-Api-Key`.
- Shared credential helpers (`src/credentials.ts`) and own-wallet payer checks (`src/payer.ts`) for on-chain writes.
- Public landing page (`src/landingPage.ts`) advertising `https://mcp.veyanet.tech/mcp` and own-wallet write rules.
- Tool surfaces: PQ crypto, public registry, fleet/sealed, and product-console tools (`src/tools/{crypto,registry,fleet,product}.ts`).
- Verification scripts: `scripts/verify-full.ts`, `scripts/verify-live-workflow.ts`, `scripts/verify-user-all.ts`, `scripts/verify-live.ts`.

### Changed
- Depends on `@veyanet/sdk@^1.2.2` so write failures align with SDK `UNFUNDED_PAYER` / `NO_TESTNET_TOKENS` and faucet export.
- Service version, health `version`, README badges, and `veya_describe` report **1.2.1**.
- Write tools stay own-wallet: gated on product API keys; empty or unfunded payer returns exactly `You don't have testnet tokens. Please get them for the transaction.`
- Health / HTTP honesty fields distinguish own-wallet writes from operator relayer writes (`writesEnabled`, `operatorRelayerWrites`).
- Docs refreshed across architecture, auth, configuration, deployment, network pin, quickstart, SDK bridge, tools, transport, and verification for the 1.2.x public paste path.
- Smoke script and config tests cover unfunded-payer mapping and the 1.2.1 health version.

### Fixed
- Product API 4xx/5xx and missing `apiKey` continue to surface as MCP `isError` so clients do not treat failed writes as success.

---

## [1.2.0] — 2026-09-17

### Changed
- Product tools take `apiKey` (`veya_dev_` / `veya_live_`) and forward `X-Api-Key` to `https://api.veyanet.tech`.
- On-chain writes are **own-wallet**: `msg.sender` is the caller's wallet (`payerPrivateKey` / `VEYA_PAYER_PRIVATE_KEY`), not a hosted relayer.
- Empty or unfunded payer returns exactly: `You don't have testnet tokens. Please get them for the transaction.`
- Guest JWT is listing-only from MCP. Writes require a product API key minted after wallet login.
- `veya_anchor_proof` uses SDK `storeCommitment` from the user wallet.
- `veya_register_environment` can confirm the tx on the product API when `environmentId` is passed (retries; `consoleSynced` reports whether the console saw it).
- `GET /v1/account` on the product API returns the wallet bound to a key (MCP `veya_account`).
- HTTP 4xx/5xx from the product API and missing `apiKey` return MCP `isError` so clients do not treat failures as success.

---

## [1.1.1] — 2026-09-14

### Changed
- Docs expanded for the public paste URL: full tool catalog, architecture charts, transport, auth, and verification.
- Tool copy distinguishes MCP-local `~/.veya` memory from product-console proofs.

---

## [1.1.0] — 2026-09-11

### Added
- Full public tool surface: PQ crypto, fleet/sealed/coordination, local memory, public registry + on-chain reads, product API session tools (guest login, environments, agents, proofs, Boundnet).
- On-chain write helpers: `veya_register_pq_onchain`, `veya_anchor_pq_attestation` (still Bearer + relayer gated).
- Config: `VEYA_VALIDATOR_NODES`, `VEYA_SEALED_NODE_URL` for server-side fleet (backend/API-owned in production).

### Changed
- Package is no longer a 6-tool teaser; auth tiers and fail-closed fleet/writes remain.
- Landing `GET /` redesigned: always advertises `https://mcp.veyanet.tech/mcp`.
- Docs rewritten for GitHub strangers: public MCP + `@veyanet/sdk` + `api.veyanet.tech` only. Consensus validators are backend/API-owned — no your host user path.


## [1.0.0] — 2026-09-07

### Added
- **Canonical Package Release**: Official `@veyanet/mcp` Streamable HTTP Model Context Protocol server for VEYA on Robinhood Chain.
- **Public MCP URL**: Production paste endpoint `https://mcp.veyanet.tech/mcp` with landing `/` and honesty `/health`.
- **Public Tools**: `veya_describe`, `veya_ping_chain`, `veya_hash_blake3`, `veya_verify_transaction`, `veya_api_health`, and `veya_writes_status` when writes are disabled.
- **Authenticated Write Tools**: `veya_store_commitment`, `veya_attest_execution`, `veya_register_environment` gated by `MCP_API_KEY` + relayer private key and Bearer authorization.
- **SDK Bridge**: All chain crypto/verify/write paths delegate to `@veyanet/sdk` (`VeyaClient` / `EvmAnchor`) with guards on writes.
- **Documentation Suite**: Publish-grade README (SDK-parity structure) plus `docs/` hub covering network pins, quickstart, architecture, tools, verification, deployment, configuration, transport, authentication, and SDK bridge.
- **Operator Scripts**: `npm test` (config + `/health` honesty) and `npm run smoke` (live initialize + tool calls).
- **Security Policy**: Coordinated disclosure via `security@veyanet.tech`; secrets hygiene for `.env` / Bearer / relayer keys.

### Security
- Fail-closed writes when keys unset or Bearer mismatches.
- Honesty fields refuse FHE / mainnet / ERC-20 claims.
- CORS allowlist for credentialed browser Origins; empty allowlist rejects unknown Origins.
