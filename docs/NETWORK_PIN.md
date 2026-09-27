# Network Specifications — `@veyanet/mcp`

Pinned settlement and public URLs. MCP and `@veyanet/sdk` must speak the **same** chain. If a host disagrees with this file, the host is misconfigured.

**[Architecture](./ARCHITECTURE.md)** • **[Verification](./VERIFICATION.md)** • **[Configuration](./CONFIGURATION.md)** • **[Quickstart](./QUICKSTART.md)**

---

## Table of contents

1. [Robinhood Chain testnet](#1-robinhood-chain-testnet)
2. [Public VEYA URLs](#2-public-veya-urls)
3. [npm packages](#3-npm-packages)
4. [Live settlement facts](#4-live-settlement-facts)
5. [Explorer links](#5-explorer-links)
6. [Example transactions](#6-example-transactions)
7. [Changing pins](#7-changing-pins)
8. [How MCP applies the pin](#8-how-mcp-applies-the-pin)

---

## 1. Robinhood Chain testnet

| Constant | Value |
|----------|-------|
| Network name | Robinhood Chain Testnet |
| Chain ID (decimal) | `46630` |
| Chain ID (hex) | `0xb626` |
| JSON-RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://explorer.testnet.chain.robinhood.com` |
| Protocol contract | `Veya.sol` (environments, agents, commitments, attestations) |
| Contract address | `0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84` |
| Native gas token | ETH (18 decimals, amounts in wei) |

Settlement today is this testnet pin. Sealed execution is **AES-256-GCM**.

---

## 2. Public VEYA URLs

These are what a stranger actually uses.

| Service | URL |
|---------|-----|
| MCP connector (Streamable HTTP) | `https://mcp.veyanet.tech/mcp` |
| MCP landing | `https://mcp.veyanet.tech/` |
| MCP health | `https://mcp.veyanet.tech/health` |
| Product API | `https://api.veyanet.tech` |
| Product API health | `https://api.veyanet.tech/health` |
| Marketing | `https://veyanet.tech` |
| MCP marketing page | `https://veyanet.tech/mcp` |

Product API health may be **`degraded`** when validators/sealed are not running on the API host. That is honest fleet status. MCP health can still be `ok`.

---

## 3. npm packages

| Package | Role |
|---------|------|
| `@veyanet/mcp` | This HTTP MCP server |
| `@veyanet/sdk` | TypeScript crypto + chain client |

GitHub (when published): [veyanet/veya-mcp](https://github.com/veyanet/veya-mcp), [veyanet/veya-sdk](https://github.com/veyanet/veya-sdk).

---

## 4. Live settlement facts

| Topic | Live value |
|-------|------------|
| Settlement | Robinhood Chain testnet **46630** |
| Contract | `Veya.sol` protocol contract at the address above |
| Sealed | AES-256-GCM |
| Public connector | `https://mcp.veyanet.tech/mcp` |
| Fleet | Owned by the product API (`api.veyanet.tech`) |
| Operator fleet defaults | Self-host MCP may call `127.0.0.1:7701–7703` and `:7800` when colocated — see [CONFIGURATION.md](./CONFIGURATION.md) |

---

## 5. Explorer links

| What | Pattern |
|------|---------|
| Contract | `{explorer}/address/{VEYA_CONTRACT_ADDRESS}` |
| Transaction | `{explorer}/tx/{txHash}` |

Contract:

```text
https://explorer.testnet.chain.robinhood.com/address/0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84
```

---

## 6. Example transactions

These are live testnet receipts used in docs. They are not placeholders.

| What | Tx |
|------|----|
| Sealed-execution commitment (common verify example) | `0xd68ab19671f0a3be63651cb6d6e24f5decf591da981708502827bca3689d31d8` |
| Guest content proof (`storeCommitment`) | `0x4314faefee6f1c635f91dd075384d4816e10abd84b9bb88e3328b51e630e395d` |
| PQ / environment registration path | `0x9a00af5ef80fdefb3734df19ad30b82aa57fa212bd493b7ad5b224a343808ad4` |

Verify the first with `veya_verify_transaction`. Open the explorer. Confirm `to` is `Veya.sol`.

---

## 7. Changing pins

Self-host operators only. If you set `ROBINHOOD_CHAIN_ID` to something else, you must also change RPC, explorer, and `VEYA_CONTRACT_ADDRESS` together.

Keep a custom pin aligned with RPC, explorer, and contract. SDK write paths call `ensureRobinhoodChain()` and reject a mismatched `eth_chainId`.

`.env.example` has `ROBINHOOD_NETWORK=testnet`. MCP `loadConfig()` uses chain id `46630` as the pin.

---

## 8. How MCP applies the pin

| Surface | Uses |
|---------|------|
| `GET /health` | `cfg.chainId`, `cfg.contractAddress` |
| `veya_describe` | Full settlement object from config |
| `veya_ping_chain` | SDK ping + `expectedChainId: cfg.chainId` |
| Write tools | `createWriteClient` → `EvmAnchor` + chain-id guard |
| Explorer URLs in write results | `client.explorerFor(txHash)` |

Related: [VERIFICATION.md](./VERIFICATION.md) to prove a live host matches this file.
