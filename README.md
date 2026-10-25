<div align="center">
  <img src="./assets/logo.png" width="400" alt="VEYA Logo" />

  # VEYA MCP

  **The official Model Context Protocol server for post-quantum agent tools, chain verification, sealed-execution service info, and protocol settlement on Robinhood Chain.**

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Package](https://img.shields.io/badge/@veyanet/mcp-1.2.10-cb3837.svg?style=flat-edge)](./package.json)
  [![Node Version](https://img.shields.io/badge/Node-%3E%3D20-green.svg?style=flat-edge)](https://nodejs.org)
  [![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue?style=flat-edge)](https://www.typescriptlang.org/)
  [![MCP Endpoint](https://img.shields.io/badge/MCP-mcp.veyanet.tech-0ea5e9.svg?style=flat-edge)](https://mcp.veyanet.tech/mcp)

  **[Official Website](https://veyanet.tech)** • **[X (Twitter)](https://x.com/withveya)** • **[Public MCP URL](https://mcp.veyanet.tech/mcp)** • **[Documentation Index](./docs/README.md)** • **[Network Specifications](./docs/NETWORK_PIN.md)** • **[Security Policy](./SECURITY.md)**

</div>

---

## 💡 Information: What is VEYA?

The **VEYA Protocol** is a decentralized, cryptographically shielded execution layer engineered for post-quantum resilient autonomous agent fleets on **Robinhood Chain**. Traditional LLM agent frameworks suffer from severe structural vulnerabilities: because agents require private execution contexts—such as API integration credentials, proprietary system prompts, treasury authority, and policy rules—running them in standard host runtimes exposes sensitive state in plaintext to host operators, database administrators, and network intermediaries.

VEYA solves this security gap by establishing client-side cryptographic boundaries and post-quantum attestation primitives. Sensitive agent workloads are protected through local post-quantum key generation (**ML-DSA-44**), quantum-resistant session negotiation (**Kyber-768**), high-throughput cryptographic digests (**BLAKE3-256**), sealed execution with **AES-256-GCM**, and **2-of-3 multi-node consensus**. This tree defaults to **Mainnet**. `Veya.sol` there is the protocol contract `0x87dC582eEA544A434a5C1e30Ca3d12c1e548a674`. `ROBINHOOD_NETWORK=testnet` keeps **Testnet**.

### The VEYA MCP Server

The `@veyanet/mcp` package is the canonical **Model Context Protocol** surface for VEYA — the full agent-facing tool set. It speaks Streamable HTTP so Claude, Cursor, and other MCP clients can paste a single URL and invoke crypto, fleet, registry, product API, and own-wallet on-chain write tools without cloning `@veyanet/sdk`. Cryptography, chain-id guards, and receipt parsing are delegated to `@veyanet/sdk`; this package owns the HTTP transport, tool registration, product `apiKey` forwarding, and the public service info.

By connecting an MCP client to `@veyanet/mcp`, you enable the following core capabilities:
*   **Paste-URL Access**: Connect via `https://mcp.veyanet.tech/mcp` (Streamable HTTP).
*   **Public Tools**: Describe the stack, ping Robinhood Chain, BLAKE3, verify `Veya.sol` txs, PQ crypto, registry, product sessions via `https://api.veyanet.tech`.
*   **Own-wallet writes**: On-chain tools need a product API key (`veya_dev_` / `veya_live_`) and **your** funded wallet. The hosted relayer is not the gas payer.
*   **SDK-Backed Settlement**: Chain calls use `@veyanet/sdk`. The default profile is Mainnet. Testnet is `ROBINHOOD_NETWORK=testnet`.
*   **Backend-owned fleet**: Consensus validators and sealed capacity belong to the product API (`https://api.veyanet.tech`).

| Surface | How users connect |
|---------|-------------------|
| **Public MCP** | Paste `https://mcp.veyanet.tech/mcp` |
| **Product API** | `https://api.veyanet.tech` (via MCP tools or direct HTTPS) |
| **SDK** | `npm install @veyanet/sdk` |

---

## 📖 Table of Contents

1. [Architectural Design Philosophy](#-architectural-design-philosophy)
2. [High-Level MCP Data Flow](#-high-level-mcp-data-flow)
3. [Installation & Environmental Requirements](#-installation--environmental-requirements)
4. [Server Configuration & Initialization](#-server-configuration--initialization)
5. [Connect in Claude / Cursor](#-connect-in-claude--cursor)
6. [Core Tools Overview](#-core-tools-overview)
    * [Service info & Discovery](#1-service-info--discovery)
    * [Chain Read & Verify](#2-chain-read--verify)
    * [BLAKE3 Commitment Helper](#3-blake3-commitment-helper)
    * [Product API Health](#4-product-api-health)
    * [Authenticated On-Chain Writes](#5-authenticated-on-chain-writes)
7. [Comprehensive Quickstart](#-comprehensive-quickstart)
8. [Transport, Auth & Reliability](#-transport-auth--reliability)
9. [Advanced Cryptography Boundaries](#-advanced-cryptography-boundaries)
10. [Operator Diagnostics & CLI Tools](#-operator-diagnostics--cli-tools)
11. [Documentation Directory Index](#-documentation-directory-index)
12. [Frequently Asked Questions (FAQ)](#-frequently-asked-questions-faq)
13. [Contributing & Security Guidelines](#-contributing--security-guidelines)
14. [License](#-license)

---

## 🛡️ Architectural Design Philosophy

The design of `@veyanet/mcp` is governed by the paradigm of **Thin Protocol Gate over Thick Cryptographic Client**. In naive MCP servers, business logic, secrets, and chain writes are mixed into tool handlers with soft auth. VEYA separates those concerns: the MCP process is a transport and policy shell; `@veyanet/sdk` remains the cryptographic engine that executes hashing, verification, and `EvmAnchor` writes.

This core philosophy is implemented through three primary architectural pillars:

### 1. Streamable HTTP as the Public Contract
Public users and agent runtimes connect with a single URL. The server implements MCP Streamable HTTP (`POST /mcp`) using `@modelcontextprotocol/sdk`.

### 2. Own-wallet write surface
On-chain write tools are always registered. Product writes need a product `apiKey` and your `payerPrivateKey`. `veya_prove` is separate: a read needs no key, and an anchor needs `environmentId` plus `payerPrivateKey` only. `msg.sender` is **your** address. An empty wallet returns: `Mainnet: 'Your wallet has no ETH on Robinhood Chain.' Testnet: 'You don't have testnet tokens. Please get them for the transaction.'`

### 3. Clear service info
`GET /health` and `veya_describe` name the selected profile, sealed = **AES-256-GCM**, and whether writes are enabled. The default profile is Mainnet. Quorum is matching hashes; unreachable nodes return `consensus_reached: false`. `Veya.sol` is a protocol contract.

---

## ⚡ High-Level MCP Data Flow

The following diagram illustrates how `@veyanet/mcp` accepts Streamable HTTP tool calls, gates writes, and settles through `@veyanet/sdk` onto Robinhood Chain:

```mermaid
flowchart TB
    subgraph ClientSpace["MCP Client (Claude / Cursor / Agent Runtime)"]
        PasteURL["Paste https://mcp.veyanet.tech/mcp"]
        ToolCall["veya_* tool invocation"]
    end

    subgraph McpBoundary["@veyanet/mcp Streamable HTTP"]
        Landing["GET /"]
        Health["GET /health"]
        PostMcp["POST /mcp"]
        Auth{"product apiKey + your wallet?"}
        PublicTools["Public tools"]
        WriteTools["Own-wallet write tools"]
    end

    subgraph SdkBoundary["@veyanet/sdk"]
        ReadClient["VeyaClient read / verify / hash"]
        EvmAnchor["EvmAnchor writes + eth_chainId guard"]
    end

    subgraph ApiBoundary["VEYA Product API"]
        ApiHealth["https://api.veyanet.tech/health"]
    end

    subgraph Blockchain["Protocol settlement (Mainnet by default)"]
        VeyaSol["Veya.sol\nCommitments · Environments · Attestations"]
    end

    PasteURL --> PostMcp
    ToolCall --> PostMcp
    PostMcp --> Auth
    Auth -->|"no key / public tools"| PublicTools
    Auth -->|"apiKey + funded payer"| WriteTools
    PublicTools --> ReadClient
    PublicTools -->|"veya_api_health"| ApiHealth
    WriteTools --> EvmAnchor
    ReadClient --> VeyaSol
    EvmAnchor --> VeyaSol
    Landing --> McpBoundary
    Health --> McpBoundary
```

---

## 📦 Installation & Environmental Requirements

### Public users (recommended)

Paste into Claude / Cursor (**Streamable HTTP**):

```text
https://mcp.veyanet.tech/mcp
```

Optional TypeScript library:

```bash
npm install @veyanet/sdk
```

### npm package (optional)

```bash
npm install -g @veyanet/mcp
veya-mcp
# or: npx -y @veyanet/mcp
```

Starts a Streamable HTTP server. After TLS, point clients at your **public HTTPS** connector. Keep `PUBLIC_MCP_URL=https://mcp.veyanet.tech/mcp` as the product paste URL in docs and landing. See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

### Requirements

*   **Node.js** ≥ **20**
*   Outbound HTTPS to Robinhood RPC and `https://api.veyanet.tech`
*   Dependency: `@veyanet/sdk` from **npm**

---

## 🔑 Server Configuration & Initialization

The process loads configuration from environment variables. Unset `ROBINHOOD_NETWORK` is Mainnet. `ROBINHOOD_NETWORK=testnet` is Testnet. Copy `.env.example` to `.env` for local overrides. **Never commit `.env`.**

### Configuration Resolution Cascade
Parameters resolve from process environment first, then the Mainnet profile (`PUBLIC_MCP_URL=https://mcp.veyanet.tech/mcp`). Testnet is `ROBINHOOD_NETWORK=testnet`. Addresses are in [docs/NETWORK_PIN.md](./docs/NETWORK_PIN.md).

```typescript
import { loadConfig, createHttpApp, startHttpServer } from "@veyanet/mcp";

// 1. Zero-config start (Mainnet)
startHttpServer();

// 2. Explicit config for operators
const cfg = loadConfig();
const app = createHttpApp(cfg);
app.listen(cfg.port, cfg.host);
```

### Environment Variables Reference

| Variable Name | Description | Default / Fallback |
|---------------|-------------|--------------------|
| `PUBLIC_MCP_URL` | Public paste URL advertised in landing + health | `https://mcp.veyanet.tech/mcp` |
| `PORT` | Listen port | `<mcp-port>` |
| `HOST` | Bind address | `0.0.0.0` |
| `ROBINHOOD_RPC_URL` | Testnet RPC (used when `ROBINHOOD_NETWORK=testnet`) | Public testnet RPC |
| `ROBINHOOD_NETWORK` | Profile | Mainnet. `testnet` selects Testnet |
| `ROBINHOOD_EXPLORER_URL` | Testnet explorer (used when `ROBINHOOD_NETWORK=testnet`) | Public testnet explorer |
| `VEYA_CONTRACT_ADDRESS` | Testnet contract (used when `ROBINHOOD_NETWORK=testnet`) | Testnet deploy address |
| `ROBINHOOD_MAINNET_CHAIN_ID` | Mainnet chain id override | Mainnet profile |
| `ROBINHOOD_MAINNET_RPC_URL` | Mainnet RPC | `https://rpc.mainnet.chain.robinhood.com` |
| `ROBINHOOD_MAINNET_EXPLORER_URL` | Mainnet explorer | `https://robinhoodchain.blockscout.com` |
| `VEYA_MAINNET_CONTRACT_ADDRESS` | Mainnet protocol contract | `0x87dC582eEA544A434a5C1e30Ca3d12c1e548a674` |
| `VEYA_API_URL` | Product API (health, registry, sessions, fleet capacity) | `https://api.veyanet.tech` |
| `CORS_ORIGIN` | Comma-separated Origin allowlist | empty = reject credentialed browser Origin |
| `NODE_ENV` | Runtime mode | `development` |
| `VEYA_PAID_CALLS` | `1` enables Paid Call Guard (3 more tools; callers pay from their own wallet). Its other `VEYA_PAID_*` settings are in [docs/CONFIGURATION.md](./docs/CONFIGURATION.md#11-paid-call-guard) | off |

Host-only settings (fleet URLs and host signing keys) are covered in the operator guide, [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). Public users never set them.

---

## 🔌 Connect in Claude / Cursor

### Production (public users / public clients)

Paste into a custom MCP connector using **Streamable HTTP** transport:

```text
https://mcp.veyanet.tech/mcp
```

No API key is required for public tools, including `veya_prove`. Product tools need `apiKey`. Product on-chain writes need that key plus **your** funded wallet. An anchor through `veya_prove` needs `environmentId` and `payerPrivateKey` only.

### Claude CLI

```bash
claude mcp add veya --transport http https://mcp.veyanet.tech/mcp
```

### Cursor IDE

Settings → MCP → Add custom MCP server / connector → URL:

```text
https://mcp.veyanet.tech/mcp
```

### Info pages

`GET https://mcp.veyanet.tech/` returns an info page (overview, capabilities, API key steps). Opening **`https://mcp.veyanet.tech/mcp`** in a browser shows setup for Cursor, Claude Code and Codex, plus an FAQ. Health: `https://mcp.veyanet.tech/health`. Product docs: `https://veyanet.tech/mcp`. Product API: `https://api.veyanet.tech`.

---

## 🧩 Core Tools Overview

`@veyanet/mcp` **1.2.10** exposes the full agent surface. Full schemas: [docs/TOOLS.md](./docs/TOOLS.md). Reads need no key. Product tools need a site API key. Product on-chain writes spend **your** wallet and also need that API key. `veya_prove` does not. `veya_seal_decision` seals an evidence id and a decision. The receipt is written when that call passes `payerPrivateKey`, or when `VEYA_SEAL_DECISION_RELAYER=1`.

### 0. Proof

```text
Tool: veya_prove
Args: exactly one of text, json, txHash
      anchor, environmentId, payerPrivateKey only when anchoring
```

One proof from text, a JSON string, or a receipt hash. Paste `https://mcp.veyanet.tech/mcp` in Cursor before the run, or the tool is not in the agent's tool list. The URL accepts `POST`. The response is a stream (`event: message` and a `data:` line).

A read sends nothing:

```json
{ "text": "hello" }
```

Text `hello` returns `mode` `digest`, `anchored` false, and digest `ea8f163db38682925e4491c5e58d4bb3506ef8c14eb78a86e908c5624a67200f`.

An anchor sends one `storeCommitment` from the wallet in `payerPrivateKey`. It does not use a product `apiKey`, and it does not use the host relayer. The environment id must already exist on `Veya.sol`. This one does: `7d0af0ba-2ae3-4d0e-bc75-0bbaccb3dd71`. A 32-hex bytes16 also parses. A hyphenated id must be a real UUID, so `00000000-0000-0000-0000-000000000001` is refused.

```json
{
  "text": "a unique string",
  "anchor": true,
  "environmentId": "7d0af0ba-2ae3-4d0e-bc75-0bbaccb3dd71",
  "payerPrivateKey": "<funded private key>"
}
```

A receipt with no VEYA log and a receipt that called another contract both return the full proof object: `ok` false, `mode` `refused`, `inputKind` `tx`, `anchored` false, plus `txHash`, `explorerUrl`, and `refusal`.

### 1. Service info & Discovery

```text
Tool: veya_describe
Args: (none)
```

Returns the service info: package name `@veyanet/mcp`, public URL, settlement, product API, sealed = AES-256-GCM, write policy.

```text
Tool: veya_writes_status
Args: (none)
```

Always registered. Explains own-wallet writes: product `apiKey` + your wallet. Empty wallet message is included.

### 2. Chain Read & Verify

```text
Tool: veya_ping_chain
Args: (none)
```

Uses `@veyanet/sdk` `VeyaClient.pingChain()` against the selected profile and returns block metadata.

```text
Tool: veya_verify_transaction
Args: txHash (0x…, min 66 chars)
```

Parses `Veya.sol` receipt events via SDK `verifyTransaction` (CommitmentStored / ExecutionAttested / related). Use a real Robinhood explorer hash.

**Example testnet commitment tx:**

```text
0xd68ab19671f0a3be63651cb6d6e24f5decf591da981708502827bca3689d31d8
```

### 3. BLAKE3 Commitment Helper

```text
Tool: veya_hash_blake3
Args: data (string, min length 1)
```

Computes a BLAKE3-256 hex digest through the SDK. Useful before an authenticated `veya_store_commitment` or for local commitment previews.

### 4. Product API Health

```text
Tool: veya_api_health
Args: (none)
```

`GET {VEYA_API_URL}/health` (default `https://api.veyanet.tech/health`). Returns HTTP status and JSON body, including fleet status.

### 5. Authenticated On-Chain Writes

Always available. `msg.sender` is **your** wallet, not the hosted relayer.

| Tool | Primary args | On-chain method |
|------|----------------|-----------------|
| `veya_store_commitment` | `apiKey`, `payerPrivateKey`, `environmentUuidHex`, `commitmentHex` | `storeCommitment` |
| `veya_attest_execution` | `apiKey`, `payerPrivateKey`, `environmentUuidHex`, `blake3HashHex`, `mldsaSigHex` | `attestExecution` |
| `veya_register_environment` | `apiKey`, `payerPrivateKey`, `environmentId` or `environmentUuidHex` | `registerEnvironment` |

Writes go through SDK `EvmAnchor`, which calls `ensureRobinhoodChain()` before submit so a mis-pointed RPC cannot silently land on another EVM. If the wallet has no ETH: `Mainnet: 'Your wallet has no ETH on Robinhood Chain.' Testnet: 'You don't have testnet tokens. Please get them for the transaction.'`

---

### 6. Paid Call Guard

```text
Tools: veya_paid_discover, veya_paid_call, veya_paid_run
On the hosted URL: yes (check paidCallGuard in /health or veya_describe)
Needs: your VEYA apiKey + your own Solana key (pays USDC) + your own Robinhood Chain key (signs the record, pays gas)
Runs: saved to your VEYA account; veya_paid_run is private to that account
Receipts: public proof links (no keys, apiKey or input)
Kill switch: operator-only; callers cannot change it
```

An agent calls a paid x402 resource through one guarded tool. VEYA checks the call against a fixed policy before anything is signed, checks your API key and both wallet balances, pays exactly the approved quote from **your** Solana wallet, verifies the payment on Solana at `finalized`, gets 2-of-3 validator signatures, anchors a commitment on `Veya.sol` from **your** Robinhood Chain address and saves the run to your VEYA account. A blocked call is never signed and moves no money. The same `idempotencyKey` never pays twice. Every run gets a receipt at `/receipts/paid/<runId>`. Receipt links are public: anyone with the link can read the proof, and a receipt never holds keys, your `apiKey` or your input. Every refusal returns `decision: "blocked"`, a stable `code` and `payment: null`. `veya_paid_discover` shows the per-call cap, the task budget maximum (0.04 USDC) and default, and for each resource the provider quote and the total charged to your task budget. See [docs/PAID_CALLS.md](./docs/PAID_CALLS.md).

Try it from any MCP client connected to `https://mcp.veyanet.tech/mcp`:

1. `veya_paid_discover` to see allowed resources, input fields and a live quote.
2. `veya_paid_call` with `taskId`, a new `idempotencyKey`, `resourceId`, `input`, your `apiKey`, your Solana secret key in `solanaPrivateKey` and your Robinhood Chain key in `robinhoodPrivateKey`.
3. Open the Solscan, Blockscout and receipt links in the reply.
4. `veya_paid_run` with your `apiKey` lists the runs saved to your account.

```json
{
  "name": "veya_paid_call",
  "arguments": {
    "taskId": "task-1",
    "idempotencyKey": "<new uuid>",
    "resourceId": "tokens.asset-risk-summary",
    "input": { "assetId": "solana" },
    "apiKey": "<your VEYA API key>",
    "solanaPrivateKey": "<your Solana secret key>",
    "robinhoodPrivateKey": "<your Robinhood Chain key>"
  }
}
```

Keys are used in memory for that one call and never stored, logged or returned. Use dedicated wallets: a little USDC and SOL on Solana, a little ETH on Robinhood Chain. A missing value returns `API_KEY_REQUIRED`, `SOLANA_KEY_REQUIRED` or `ROBINHOOD_KEY_REQUIRED` and nothing happens. Servers without `VEYA_PAID_CALLS=1` list 51 tools; with it, 54. Guide: [docs/PAID_CALLS.md](./docs/PAID_CALLS.md).

---

## 🚀 Comprehensive Quickstart

### A. Public path (no keys, no clone)

1. Open Claude or Cursor MCP settings.
2. Add Streamable HTTP URL: `https://mcp.veyanet.tech/mcp`.
3. Ask the agent to run `veya_prove` with `{ "text": "hello" }`.
4. Ask the agent to run `veya_describe`.
5. Ask the agent to run `veya_ping_chain` and confirm the profile is the one you selected.

### B. Developer path (local process)

```bash
git clone https://github.com/veyanet/veya-mcp.git
cd veya-mcp
npm install
cp .env.example .env   # do not commit .env
npm run build
npm start
```

In another terminal:

```bash
npm test
npm run smoke
```

Smoke starts an in-process server, performs MCP initialize + `tools/list`, then calls `veya_describe` and `veya_ping_chain` against live RPC.

### C. Product write path (your funded wallet)

These tools need a product `apiKey`. `veya_prove` does not. An anchor on `veya_prove` is `environmentId` plus `payerPrivateKey` only.

1. Create a `veya_dev_` / `veya_live_` key at [app.veyanet.tech](https://app.veyanet.tech): connect your wallet, open **System → API Keys**, and create a Dev (`veya_dev_…`) or Live (`veya_live_…`) key. The key is shown once.
2. Set `VEYA_PAYER_PRIVATE_KEY` on a self-hosted server, or pass `payerPrivateKey` on the tool. The public `veya_prove` tool reads only the argument.
3. Call `veya_store_commitment` (or `veya_anchor_proof`) with `apiKey`.
4. Confirm `from` in the result is your address, and open the explorer `txHash`.
5. If the wallet is empty you get: `Mainnet: 'Your wallet has no ETH on Robinhood Chain.' Testnet: 'You don't have testnet tokens. Please get them for the transaction.'`

---

## ⚠️ Transport, Auth & Reliability

### HTTP Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Landing HTML with paste URL |
| `GET` | `/health` | service info (service, version, chain, writesEnabled, sealed) |
| `POST` | `/mcp` | Stateless Streamable HTTP MCP |
| `POST` | `/mcp/session` | Optional sessionful path (`MCP-Session-Id`) |

### CORS
`CORS_ORIGIN` is an allowlist. Empty allowlist rejects credentialed browser `Origin` values. Server-to-server MCP clients (no Origin) are unaffected.

### Auth Model
*   Public tools: no key.
*   Product tools: `apiKey` from the product site (`X-Api-Key` toward `api.veyanet.tech`).
*   Write tools: same `apiKey` plus **your** `payerPrivateKey`. `from` is your address.
*   Private keys never appear in `/health` or success payloads.

### Failure Modes
*   Wrong RPC chain id on writes → SDK `CHAIN_MISMATCH` (fail closed).
*   Missing `apiKey` → `{ "error": "apiKey required" }`.
*   Unfunded payer → `Mainnet: 'Your wallet has no ETH on Robinhood Chain.' Testnet: 'You don't have testnet tokens. Please get them for the transaction.'`
*   `veya_api_health` returns the API status.

---

## 🔒 Advanced Cryptography Boundaries

`@veyanet/mcp` does **not** re-implement PQ algorithms. It calls `@veyanet/sdk`, which provides:

### 1. ML-DSA-44 Post-Quantum Identity (FIPS 204)
Used when operators submit attestation signature bytes through `veya_attest_execution`. Verification of ML-DSA remains off-chain in the SDK / auditors; the chain stores bounded attestation bytes and hashes.

### 2. BLAKE3-256 Digesting
`veya_hash_blake3` and commitment writes use 32-byte digests. Use-mode human content proofs on the product console may use SHA-256 for browser convenience; MCP commitment helpers follow the SDK BLAKE3 path.

### 3. AES-256-GCM Sealed Execution
Sealed execution runs in the operator sealed node with AES-256-GCM.

### 4. Chain Id Guard
`EvmAnchor.ensureRobinhoodChain()` runs before on-chain writes so MCP operators cannot accidentally settle on the wrong EVM.

---

## 🛠️ Operator Diagnostics & CLI Tools

The package ships with verification scripts for operators and publishers:

```bash
# Typecheck
npm run lint

# Unit + HTTP /health service info (service name, network, AES string)
npm test

# Live MCP initialize + tools/list + ping (needs network)
npm run smoke

# Production-style process
npm run build && npm start
```

Health probe:

```bash
curl -s https://mcp.veyanet.tech/health | jq .
# or local:
curl -s https://mcp.veyanet.tech/health | jq .
```

Expected service info fields include `service: "@veyanet/mcp"`, `network` for the selected profile, `sealed` mentioning `AES-256-GCM`, and `writesEnabled` boolean. This tree's default `network` is `mainnet`.

Production TLS for `mcp.veyanet.tech`: see **[Deployment Guide](./docs/DEPLOYMENT.md)**.

---

## 📚 Documentation Directory Index

This README serves as the entry point. For detailed operational and integrator material, refer to the documentation directory:

| Document | Topic | Description |
|----------|-------|-------------|
| **[Documentation Hub](./docs/README.md)** | Index | Master catalog and reading paths for public users vs operators. |
| **[Network Specifications](./docs/NETWORK_PIN.md)** | Network | Chain id, RPC, explorer, `Veya.sol` address, public MCP URL. |
| **[Quickstart Guide](./docs/QUICKSTART.md)** | Tutorial | Paste URL → first tools → local loop → smoke. |
| **[System Architecture](./docs/ARCHITECTURE.md)** | Security | Trust boundaries between MCP, SDK, API, and chain. |
| **[Tools Reference](./docs/TOOLS.md)** | Reference | Every `veya_*` tool, args, and auth requirements. |
| **[Verification Guide](./docs/VERIFICATION.md)** | Audit | How to prove a commitment via MCP + explorer. |
| **[Deployment Guide](./docs/DEPLOYMENT.md)** | Operations | nginx, env, systemd, TLS for `mcp.veyanet.tech`. |
| **[Configuration Reference](./docs/CONFIGURATION.md)** | Config | Full environment variable cascade and defaults. |
| **[HTTP Transport](./docs/TRANSPORT.md)** | Protocol | Streamable HTTP, sessions, CORS, Accept headers. |
| **[Authentication & Writes](./docs/AUTHENTICATION.md)** | Security | Product API key vs your wallet; funding. |
| **[SDK Relationship](./docs/SDK_BRIDGE.md)** | Integration | What MCP calls in `@veyanet/sdk` and the product API. |
| **[Paid Call Guard](./docs/PAID_CALLS.md)** | Opt-in feature | Paid x402 calls under a VEYA policy, verified on Solana and recorded on Robinhood Chain. |
| **[Changelog](./CHANGELOG.md)** | History | Package version history. |
| **[Security Policy](./SECURITY.md)** | Security | Disclosure and secrets hygiene. |

---

## ❓ Frequently Asked Questions (FAQ)

### 1. Do I need an API key to try VEYA MCP?
**No** for public tools (`veya_describe`, `veya_ping_chain`, `veya_hash_blake3`, `veya_verify_transaction`, `veya_api_health`). Product rooms and on-chain writes need a `veya_dev_` / `veya_live_` key from the product site. On-chain writes also need **your** funded wallet.

### 2. Does the MCP store or transmit my private keys to clients?
**No** in tool results or `/health`. If you pass `payerPrivateKey` to the public HTTP URL, that host holds it for the call — prefer self-host with `VEYA_PAYER_PRIVATE_KEY`. Never use a mainnet key.

### 3. What is Veya.sol?
`Veya.sol` is a protocol contract for environments, agents, commitments, spending limits (wei), nullifiers, and attestations.

### 4. What is sealed execution?
The service info names **AES-256-GCM** sealed-node cryptography (software process boundary).

### 5. How is MCP different from `@veyanet/sdk`?
The SDK is a TypeScript library you import. MCP is a network service that exposes selected SDK capabilities as MCP tools over Streamable HTTP so agents can paste a URL.

### 6. How do I connect?
Paste `https://mcp.veyanet.tech/mcp`. Consensus and sealed capacity belong to the product API (`https://api.veyanet.tech`). Use `@veyanet/sdk` from npm for TypeScript.

### 7. What happens if Robinhood RPC is down?
`veya_ping_chain` and verify tools fail with transport / RPC errors. Check `https://mcp.veyanet.tech/health` and the Robinhood RPC independently.

### 8. Can I point this server at another chain id?
Select Mainnet or Testnet with `ROBINHOOD_NETWORK`. Do not point the RPC at a different chain from the profile. SDK writes reject that mismatch. Mainnet is the default profile in this tree.

---

## 🤝 Contributing & Security Guidelines

### Contribution Standards
We welcome contributions to `@veyanet/mcp`. Pull requests must preserve security integrity:
*   **Own-wallet writes**: Do not send chain txs from a hosted relayer when the caller has a product API key; `msg.sender` must be the user's wallet.
*   **Secret Hygiene**: Reject changes that log `apiKey`, `payerPrivateKey`, or dump `.env` into docs.
*   **SDK Boundary**: Prefer calling `@veyanet/sdk` over re-implementing hashing, verify, or `EvmAnchor` inside tool handlers.

### Vulnerability Disclosure Policy
If you discover a security vulnerability, **do not file a public GitHub issue**.
Submit findings confidentially to **security@veyanet.tech**. See our [Security Policy](./SECURITY.md) for full details.

---

## 📄 License

This package is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for legal details.
