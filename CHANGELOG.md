# Changelog

All notable changes to the `@veyanet/mcp` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.10] — 2026-10-25

This release completes the Paid Call Guard introduced in 1.2.9: every run is tied to a VEYA account, the caller signs with their own Solana and Robinhood Chain keys, and every refusal now has one stable, machine-readable shape.

### Added
- **Account-bound runs.** `veya_paid_call` accepts `apiKey` (a VEYA product API key). The key is validated against the VEYA API before anything is signed, and every run (state, payment, validator result, Robinhood Chain record and receipt link) is saved to that account. Request input, provider answers and keys are never saved.
- **Caller-signed payments and records.** `solanaPrivateKey` (base58 or a JSON array of 64 numbers) pays the USDC on Solana mainnet, and `robinhoodPrivateKey` signs the `storeCommitment` record on `Veya.sol` and pays its gas. Keys are used in memory for that one call, are never stored, logged, written to state or receipts, or returned, and the Solana key bytes are wiped after use.
- **Pre-flight checks before signing:** API key (`API_KEY_REQUIRED`, `API_KEY_INVALID`, `API_UNAVAILABLE`), wallet keys (`SOLANA_KEY_REQUIRED` / `SOLANA_KEY_INVALID`, `ROBINHOOD_KEY_REQUIRED` / `ROBINHOOD_KEY_INVALID`), policy, the target `Veya.sol` environment (`ENVIRONMENT_NOT_FOUND`), gas for the record (`ROBINHOOD_INSUFFICIENT_GAS`) and USDC balance (`PAYER_INSUFFICIENT_FUNDS`).
- **Account history.** `veya_paid_run` with an `apiKey` lists that account's runs or reads a single run. Runs belonging to another account are reported as `unknown run`.
- **Limits up front.** `veya_paid_discover`, `veya_describe` and `/health` (`paidCallGuard.limits`) report the per-call cap, the largest total per call, the task budget maximum, the default task budget and calls per task, all read from the policy config.
- **Quote vs total.** `veya_paid_discover` returns `amounts` per resource (provider quote, provider fee and total charged to the task budget) with an explanatory note, so a preview that differs from the bare quote is no longer surprising.
- **Status block.** `paidCallGuard` in `/health` and `veya_describe` shows whether the guard is enabled, the kill switch state, the tools, the required arguments and where runs are saved, with no keys or file paths.
- Optional `environmentUuid` on `veya_paid_call` to record under your own `Veya.sol` environment; the default is shown by `veya_paid_discover` as `defaultEnvironmentUuid`.
- Replies include `veya.from` (the address that signed the record), `account.saved`, `validators` (`agreed`, `required`, `total`, `reached`) and `veya.anchor` (`anchored`, `failed`, `pending`, `not_attempted`).
- The policy config now ships in the package as `config/paid-calls.json` (allowlists, pins, caps; no secrets). Validator endpoints are supplied through `VEYA_PAID_VALIDATOR_NODES`.
- Paid Call Guard section and FAQ entry on the MCP landing page and the browser view of `/mcp`.
- Receipts show the paying wallet's public address.
- New test suites for account mode, caller-signed payments, refusal shape, limits and receipt privacy.

### Changed
- **Breaking:** the Solana key argument is renamed from `payerPrivateKey` to `solanaPrivateKey`. The old name is now rejected as an unknown argument. `apiKey` is required on `veya_paid_call`.
- Idempotency keys, task budgets and run reads are scoped per VEYA account, so two accounts can never collide on the same key and a repeated request inside one account never pays twice.
- The policy gate (tool, host, resource, network, asset, payee, per-call cap, task budget, call count and input) runs before any key is touched or any transaction is signed.
- Each run records its payer address and Robinhood Chain sender; payment verification, the 2-of-3 validator evidence, reconciliation and the commitment all use those addresses.
- A committed run's `reason` now reads `Recorded on Robinhood Chain in block N, transaction 0x…` instead of only `block N`.
- Resuming a `commit_failed` run takes `robinhoodPrivateKey` on `veya_paid_run`, because the caller's key signs the record.
- `scripts/paid-call-example.mts` reads the API key and wallet keys from files (`VEYA_API_KEY_FILE`, `SOLANA_KEY_FILE`, `ROBINHOOD_KEY_FILE`) instead of the environment.
- Documentation (README, `PAID_CALLS.md`, `TOOLS.md`, `AUTHENTICATION.md`, `CONFIGURATION.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, `QUICKSTART.md`, `TRANSPORT.md`, `VERIFICATION.md`, `SDK_BRIDGE.md`, `SECURITY.md`) rewritten for the account-bound flow, with the full refusal code table and limits.

### Fixed
- Every blocked or refused `veya_paid_call` reply (auth failures, missing wallet keys, schema errors, policy denials, limits, kill switch and replays of a denied run) now returns `decision: "blocked"`, a stable `code`, `state`, `reason` and `payment: null`.
- `veya_paid_*` tools reject unknown arguments with `INPUT_INVALID` instead of silently dropping them; only the count is reported, never argument names or values.
- `tools/list` now marks the required arguments of `veya_paid_call` exactly as the runtime enforces them, and `veya_paid_discover` declares `additionalProperties: false` like the other guard tools. Input fields carry descriptions.
- `veya_paid_run` with `resume: true` on a `commit_failed` run no longer throws `STATE: illegal commit_failed -> commit_failed`; a retry that fails again keeps the state with a `retry:` reason and never pays again.
- `veya_paid_run` with `resume: true` now retries a `quorum_failed` run by re-running only the validator check and the Robinhood Chain record.
- Error text in a run's `reason` is trimmed to the short message: RPC payloads, signed transaction data and server file paths are removed.
- A repeat of an idempotency key whose run is still in progress returns `decision: "pending"` with `IN_PROGRESS` rather than `blocked`.
- A receipt for a run that did not complete no longer describes itself as cross-chain evidence; the HTML footer states what happened and the JSON includes the failure `reason`.
- Tool replies link receipts at `/receipts/paid/<runId>`. `VEYA_PAID_RECEIPTS_BASE_URL` may be the site origin or the full receipts base; without it the reply shows the relative route, never a file path.
- With the guard enabled, the HTTP server now stops at boot with a clear message if the guard cannot start (missing validators, locked state folder) instead of failing every MCP session with a generic error.

### Security
- The kill switch (`"enabled": false` in config, `VEYA_PAID_CALLS_DISABLED=1`, or a `DISABLED` file) is operator-only and documented as such; no tool argument can change it. When on, calls are refused with `EMERGENCY_DISABLED` and `payment: null`.
- `veya_paid_run` is private to the API key's account. Receipt links are public payment proof and contain no API key, wallet keys, request input or provider answer.
- Keys and API keys never appear in replies, receipts, saved runs or logs.

## [1.2.9] — 2026-10-25

### Added
- **Paid Call Guard** (opt-in, `VEYA_PAID_CALLS=1`). Three tools: `veya_paid_discover` (read-only quote and policy preview), `veya_paid_call` (one guarded call) and `veya_paid_run` (read or resume a run; never pays). An agent calls an x402 resource under a fixed VEYA policy: tool, host, resource, network, asset, payee, per-call cap, task budget, call count, approval threshold and input are checked before anything is signed. Guide: [docs/PAID_CALLS.md](./docs/PAID_CALLS.md).
- Two payer paths, chosen per provider or resource in `config/paid-calls.json`: `xpay-sdk` (xPay SDK `use()` with its guardrails) and `x402-exact` (standard x402 `exact` client).
- Evidence: the Solana payment is verified at `finalized` (payer, payee, mint, amount), 3 validator nodes on separate RPC providers sign the evidence with ML-DSA-44 (2 of 3 must agree), and a commitment is anchored on `Veya.sol` with `storeCommitment`.
- Receipt route `GET /receipts/paid/:runId` (HTML) and `/receipts/paid/:runId.json`. Public fields only, with no request input or answer.
- Kill switch: `"enabled": false` in config, `VEYA_PAID_CALLS_DISABLED=1`, or a `DISABLED` file in the state folder.
- Idempotency keys, a run state machine, budget reservation for parallel calls and a process-wide ledger lock (`STATE_LOCKED`).
- `node dist/cli.js --stdio` serves the tools over stdio for a single local client.

### Changed
- The chain ID is no longer included in public output: `/health`, `/healthz`, `veya_describe`, `veya_ping_chain`, proof and seal-decision replies, and proxied product API replies. Chain validation still runs inside the SDK and fails closed on a mismatch.
- Service version, health `version` and `veya_describe` report **1.2.9**. Depends on `@veyanet/sdk` 1.2.9. Publish the SDK first.

### Fixed
- Docs: pinned versions, native-unit note for `Veya.sol` spend values, kill-switch reply, Mainnet contract and explorer link in VERIFICATION.md, and health field tables.

### Unchanged
- Without `VEYA_PAID_CALLS=1` the server lists the same 51 tools and routes as before (54 with it on). No contract change.

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
