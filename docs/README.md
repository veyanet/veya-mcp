# Documentation Hub — `@veyanet/mcp`

This folder is the documentation set for `@veyanet/mcp`. The default profile is **Mainnet**. **Testnet** is `ROBINHOOD_NETWORK=testnet`. Pins are in [NETWORK_PIN.md](./NETWORK_PIN.md).

The root [README.md](../README.md) is the publish-facing intro. **CHANGELOG.md** at the repo root is the version history (leave that file as the source of releases). This hub is how a public user learns **how the server is built** and **what each tool does**.

---

## Start here

1. Paste `https://mcp.veyanet.tech/mcp` into Claude or Cursor (Streamable HTTP).
2. Read [QUICKSTART.md](./QUICKSTART.md) and run `veya_describe` → `veya_ping_chain`.
3. Confirm pins in [NETWORK_PIN.md](./NETWORK_PIN.md).
4. Look up any tool in [TOOLS.md](./TOOLS.md).
5. For pictures of trust and layers, read [ARCHITECTURE.md](./ARCHITECTURE.md).

You need **public MCP**, optionally **`@veyanet/sdk`**, and the **product API** at `https://api.veyanet.tech`.

---

## Reading paths

| If you want to… | Read |
|-----------------|------|
| Connect in five minutes | [QUICKSTART.md](./QUICKSTART.md) |
| Know chain id, contract, public URLs | [NETWORK_PIN.md](./NETWORK_PIN.md) |
| Understand **every tool** (what it does, args, returns) | [TOOLS.md](./TOOLS.md) |
| See layers, sequence charts, trust, failures | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Know HTTP paths, SSE, CORS, stateless `/mcp` | [TRANSPORT.md](./TRANSPORT.md) |
| Know product key vs your wallet | [AUTHENTICATION.md](./AUTHENTICATION.md) |
| Self-host env vars | [CONFIGURATION.md](./CONFIGURATION.md) |
| Put TLS in front of Node | [DEPLOYMENT.md](./DEPLOYMENT.md) |
| Prove it as an auditor | [VERIFICATION.md](./VERIFICATION.md) |
| Run paid x402 calls under a VEYA policy, paid from your own wallet | [PAID_CALLS.md](./PAID_CALLS.md) |
| See what is SDK vs API | [SDK_BRIDGE.md](./SDK_BRIDGE.md) |
| Contribute a tool | [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| Report a security bug | [../SECURITY.md](../SECURITY.md) |

```mermaid
flowchart TB
  Q["QUICKSTART"] --> T["TOOLS"]
  Q --> N["NETWORK_PIN"]
  T --> A["ARCHITECTURE"]
  A --> X["TRANSPORT / AUTH"]
  X --> C["CONFIGURATION / DEPLOYMENT"]
  A --> S["SDK_BRIDGE"]
  N --> V["VERIFICATION"]
```

---

## Package facts

| Item | Value |
|------|-------|
| npm | `@veyanet/mcp` **1.2.10** |
| SDK | `@veyanet/sdk` **^1.2.9** |
| Public connector | `https://mcp.veyanet.tech/mcp` |
| Product API | `https://api.veyanet.tech` |
| Default profile | Mainnet |
| Testnet (optional) | `ROBINHOOD_NETWORK=testnet` |
| Mainnet contract | `0x87dC582eEA544A434a5C1e30Ca3d12c1e548a674` (protocol contract, not a token) |
| Sealed | AES-256-GCM |
| Writes | Own-wallet (product `apiKey` + your wallet) |

---

## Live facts

- `Veya.sol` is a protocol contract (environments, agents, commitments, attestations).
- Default network: Mainnet.
- Guest sessions are **Use-only** (Build returns API **403**).
- Quorum is matching BLAKE3 hashes (2-of-3); unreachable nodes return `consensus_reached: false`.
- Public paste URL is `https://mcp.veyanet.tech/mcp`.
