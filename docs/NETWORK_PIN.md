# Network Specifications — VEYA MCP

Pinned settlement constants for `@veyanet/mcp`. These match `@veyanet/sdk` defaults so MCP tools and library callers speak the same chain.

## Robinhood Chain testnet

| Constant | Value |
|----------|-------|
| Network name | Robinhood Chain Testnet |
| Chain ID (decimal) | `46630` |
| Chain ID (hex) | `0xb636` |
| JSON-RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://explorer.testnet.chain.robinhood.com` |
| Protocol contract | `Veya.sol` |
| Contract address | `0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84` |

## Public VEYA endpoints

| Service | URL |
|---------|-----|
| MCP (Streamable HTTP) | `https://mcp.veyanet.tech/mcp` |
| MCP landing | `https://mcp.veyanet.tech/` |
| MCP health | `https://mcp.veyanet.tech/health` |
| Product API | `https://api.veyanet.tech` |
| Product API health | `https://api.veyanet.tech/health` |
| Marketing site | `https://veyanet.tech` |

## What is not pinned here

| Claim | Status |
|-------|--------|
| Mainnet chain id / contract | **Not** a VEYA settlement claim until Phase 3 |
| ERC-20 / token address | **Never** — `Veya.sol` is not a token |
| Live FHE / TFHE | **Not** — sealed path is AES-256-GCM; TFHE is a later phase |
| Loopback validators `7701–7703` | Local ops only; not required for public MCP read tools |
| Sealed-node `7800` | Local / fleet ops; not this MCP’s default execution surface |

## Changing pins

If you change `ROBINHOOD_CHAIN_ID`, you must also change RPC, explorer, and `VEYA_CONTRACT_ADDRESS` together. SDK write paths call `ensureRobinhoodChain()` and will reject a mismatched `eth_chainId`. Do not advertise a custom pin as “VEYA production” unless the protocol deploy and docs agree.

## Explorer checks

* Contract: `{explorer}/address/{VEYA_CONTRACT_ADDRESS}`
* Transaction: `{explorer}/tx/{txHash}`

Example commitment transaction used in smoke / docs:

```text
0xd68ab19671f0a3be63651cb6d6e24f5decf591da981708502827bca3689d31d8
```
