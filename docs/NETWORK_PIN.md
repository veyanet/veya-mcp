# Networks — `@veyanet/mcp`

The default profile is **Mainnet**. **Testnet** is `ROBINHOOD_NETWORK=testnet`. MCP and `@veyanet/sdk` use the same profiles. Numeric ids are listed once in the tables below.

**[Architecture](./ARCHITECTURE.md)** • **[Verification](./VERIFICATION.md)** • **[Configuration](./CONFIGURATION.md)** • **[Quickstart](./QUICKSTART.md)**

---

## Table of contents

1. [Profiles](#1-profiles)
2. [Public VEYA URLs](#2-public-veya-urls)
3. [npm packages](#3-npm-packages)
4. [Live settlement facts](#4-live-settlement-facts)
5. [Explorer links](#5-explorer-links)
6. [Example transactions](#6-example-transactions)
7. [Changing pins](#7-changing-pins)
8. [How MCP applies the pin](#8-how-mcp-applies-the-pin)

---

## 1. Profiles

`Veya.sol` is a protocol contract. It is not a token. Sealed execution is **AES-256-GCM**.

### Mainnet (default)

| Constant | Value |
|----------|-------|
| Profile | Mainnet |
| JSON-RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Contract | `0x87dC582eEA544A434a5C1e30Ca3d12c1e548a674` |
| Select | Omit `ROBINHOOD_NETWORK`, or set it to `mainnet` |
| Payer slot | `VEYA_MAINNET_RELAYER_PRIVATE_KEY` only |

### Testnet

| Constant | Value |
|----------|-------|
| Profile | Testnet (optional) |
| JSON-RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://explorer.testnet.chain.robinhood.com` |
| Contract | `0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84` |
| Select | `ROBINHOOD_NETWORK=testnet` |
| Payer slot | `VEYA_RELAYER_PRIVATE_KEY`, then `VEYA_DEPLOYER_PRIVATE_KEY` |

---

## 2. Public VEYA URLs

These are what a public user actually uses.

| Service | URL |
|---------|-----|
| MCP connector (Streamable HTTP) | `https://mcp.veyanet.tech/mcp` |
| MCP landing | `https://mcp.veyanet.tech/` |
| MCP health | `https://mcp.veyanet.tech/health` |
| Product API | `https://api.veyanet.tech` |
| Product API health | `https://api.veyanet.tech/health` |
| Website | `https://veyanet.tech` |
| MCP page | `https://veyanet.tech/mcp` |

Product API health shows fleet status (ok or degraded). MCP health can still be `ok`.

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
| This tree | Mainnet unless `ROBINHOOD_NETWORK=testnet` |
| Contract | `Veya.sol`, protocol contract, not a token |
| Sealed | AES-256-GCM |
| Public connector | `https://mcp.veyanet.tech/mcp` |
| Fleet | Owned by the product API (`api.veyanet.tech`) |
| Operator fleet defaults | Self-host MCP may call `<validator-1..3-url>` and `:<sealed-port>` when colocated — see [CONFIGURATION.md](./CONFIGURATION.md) |

---

## 5. Explorer links

| What | Pattern |
|------|---------|
| Contract | `{explorer}/address/{VEYA_CONTRACT_ADDRESS}` |
| Transaction | `{explorer}/tx/{txHash}` |

Mainnet contract:

```text
https://robinhoodchain.blockscout.com/address/0x87dC582eEA544A434a5C1e30Ca3d12c1e548a674
```

Testnet contract, when `ROBINHOOD_NETWORK=testnet`:

```text
https://explorer.testnet.chain.robinhood.com/address/0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84
```

---

## 6. Example transactions

These are example Testnet receipts (optional profile).

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

`ROBINHOOD_NETWORK=testnet` selects Testnet. Any other value, including unset, selects Mainnet. An explicit empty `VEYA_MAINNET_CONTRACT_ADDRESS` stays unpublished and sends nothing.

---

## 8. How MCP applies the pin

| Surface | Uses |
|---------|------|
| `GET /health` | `cfg.network`, `cfg.contractAddress` (chain ID not shown) |
| `veya_describe` | Full settlement object from config |
| `veya_ping_chain` | SDK ping (block, contract); chain ID checked internally, not shown |
| Write tools | `createWriteClient` → `EvmAnchor` + chain-id guard |
| Explorer URLs in write results | `client.explorerFor(txHash)` |

Related: [VERIFICATION.md](./VERIFICATION.md) to prove a live host matches this file.
