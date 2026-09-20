# Contributing — `@veyanet/mcp`

How to change this repo without breaking honesty, stranger paths, or the write gate.

Security reports go to **security@veyanet.tech** — see [SECURITY.md](./SECURITY.md). Do not open public issues for key leaks or auth bypasses.

---

## Table of contents

1. [What this repo is](#1-what-this-repo-is)
2. [Setup](#2-setup)
3. [Commands](#3-commands)
4. [Layout](#4-layout)
5. [Honesty rules](#5-honesty-rules)
6. [Adding a tool](#6-adding-a-tool)
7. [Docs](#7-docs)
8. [Secrets](#8-secrets)
9. [Pull requests](#9-pull-requests)

---

## 1. What this repo is

A Streamable HTTP MCP server. Cryptography and `Veya.sol` writes live in **`@veyanet/sdk`** (npm). Product rooms live on **`https://api.veyanet.tech`**.

Do not add a second hash function “just in MCP.” Call the SDK.

`npm install` must work on a **fresh clone** using the registry (`@veyanet/sdk`), not a sibling `../sdk` path.

---

## 2. Setup

Node 20+.

```bash
npm install
cp .env.example .env   # local only; never commit
npm run lint
npm test
npm run smoke
```

The CLI does not auto-load `.env`. Export vars or use a process manager. `scripts/verify-full.ts` may read `.env` for a test payer without printing it.

---

## 3. Commands

| Script | Purpose |
|--------|---------|
| `npm run build` | `tsup` → `dist/` |
| `npm run dev` | `tsx watch src/cli.ts` |
| `npm start` | `node dist/cli.js` |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | `tsx --test src/**/*.test.ts` |
| `npm run smoke` | In-process initialize + tools/list + describe + ping |

---

## 4. Layout

```text
src/cli.ts            binary entry
src/http.ts           Express routes
src/server.ts         McpServer + register*Tools
src/config.ts         env + writesEnabled
src/auth.ts           Bearer
src/sdk.ts            VeyaClient factories
src/api.ts            product API fetch
src/tools/public.ts   honesty + chain reads
src/tools/crypto.ts   PQ
src/tools/fleet.ts    consensus, sealed, Boundnet, local memory
src/tools/registry.ts public API + eth_call
src/tools/product.ts  session / guest
src/tools/write.ts    on-chain writes OR veya_writes_status
docs/                 human documentation
```

---

## 5. Honesty rules

These are load-bearing. Docs and tool strings must match:

1. Chain id **46630** (Robinhood testnet).
2. Sealed = **AES-256-GCM**.
3. `Veya.sol` is a protocol contract.
4. Public paste URL is `https://mcp.veyanet.tech/mcp`.
5. Guest Build = product API **403**.
6. If validators are down, consensus reports `consensus_reached: false`.
7. On-chain writes are user-paid: product `apiKey` + the user's wallet. Empty wallet → the testnet-tokens sentence.
8. Boundnet in `fleet.ts` is **in-process SDK** policy; product Boundnet is `veya_boundnet_invoke`. Keep those distinct in TOOLS.md.
9. Local memory is `~/.veya` on the MCP host; console proofs are the product API.

Update [docs/TOOLS.md](./docs/TOOLS.md) in the **same PR** as a new or renamed tool.

---

## 6. Adding a tool

1. Pick the right file (`public` / `crypto` / `fleet` / `registry` / `product` / `write`).
2. Use `server.tool(name, description, zodShape, handler)`.
3. Description must be honest (testnet, AES, fail closed).
4. Return `toolJson` / `toolError` from `src/api.ts` unless you have a reason to match `public.ts` raw content.
5. Product tools: `apiKey` argument (`veya_dev_` / `veya_live_`); never treat a guest JWT as a write credential.
6. Write tools: product `apiKey` + user `payerPrivateKey`; hex lengths 16-byte UUID / 32-byte digest. `from` is the user address.
7. Add the tool to [docs/TOOLS.md](./docs/TOOLS.md): what it does, when to use it, args, returns, what it does **not** do, auth.
8. If the tool changes architecture, update [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) and [docs/SDK_BRIDGE.md](./docs/SDK_BRIDGE.md).
9. Extend smoke if the tool is always registered (`tools/list` already asserts ≥ 30 names plus ping/describe/verify/hash).

User-paid write tools are always registered. Do not send those txs from a hosted relayer.

---

## 7. Docs

Style:

- Simple words, real detail.
- Charts (mermaid) where they explain trust or request flow.
- Document only what the code does.
- Public docs use public URLs and npm package names.
- [CHANGELOG.md](./CHANGELOG.md) is version history — keep release notes there.

Depth bar: the SDK architecture doc. MCP docs should explain **this** package that clearly.

Hub: [docs/README.md](./docs/README.md).

---

## 8. Secrets

Never commit `.env`, funded keys, or `MCP_API_KEY`. `.env.example` stays empty of secrets.

Do not log `privateKeyHex` from PQ keygen in server logs.

---

## 9. Pull requests

- Include `npm run lint && npm test && npm run smoke` locally.
- One logical change is easier to review than a grab-bag.
- If you change default pins, update `docs/NETWORK_PIN.md` and health/describe strings together.
