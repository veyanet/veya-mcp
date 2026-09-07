# VEYA MCP — Documentation Hub

This directory is the documentation set for `@veyanet/mcp`, the Streamable HTTP Model Context Protocol server for VEYA on Robinhood Chain. The root [README.md](../README.md) is the publish-facing entry (same role as `@veyanet/sdk`’s README). Use the table below for depth.

## Reading paths

### Stranger / agent client
1. [QUICKSTART.md](./QUICKSTART.md) — paste `https://mcp.veyanet.tech/mcp`
2. [TOOLS.md](./TOOLS.md) — what each `veya_*` tool does
3. [NETWORK_PIN.md](./NETWORK_PIN.md) — chain id, contract, explorer
4. [VERIFICATION.md](./VERIFICATION.md) — prove a commitment without trusting UI screenshots

### Operator / deployer
1. [DEPLOYMENT.md](./DEPLOYMENT.md) — TLS, nginx, systemd, env
2. [CONFIGURATION.md](./CONFIGURATION.md) — every environment variable
3. [AUTHENTICATION.md](./AUTHENTICATION.md) — Bearer write gate
4. [TRANSPORT.md](./TRANSPORT.md) — Streamable HTTP details

### Integrator / security reviewer
1. [ARCHITECTURE.md](./ARCHITECTURE.md) — trust boundaries
2. [SDK_BRIDGE.md](./SDK_BRIDGE.md) — what MCP calls in `@veyanet/sdk`
3. [../SECURITY.md](../SECURITY.md) — disclosure

## Package identity

| Item | Value |
|------|-------|
| npm / service name | `@veyanet/mcp` |
| Monorepo directory | `robinhood/hosted-mcp/` |
| Public URL | `https://mcp.veyanet.tech/mcp` |
| Sibling SDK | `robinhood/sdk` (`@veyanet/sdk`) |
| Stdio MCP (operators) | `veya-anchor/packages/mcp/` |

## Honesty (always)

* Settlement today: Robinhood Chain **testnet** chain id **46630**
* Protocol contract: `Veya.sol` (not an ERC-20)
* Sealed execution elsewhere: **AES-256-GCM** (not FHE; not SGX/Nitro product path)
* Mainnet: Phase 3 — not a current VEYA settlement claim

## Catalog

| Document | Description |
|----------|-------------|
| [NETWORK_PIN.md](./NETWORK_PIN.md) | Network constants and pins |
| [QUICKSTART.md](./QUICKSTART.md) | First connect and first tools |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Trust model and component map |
| [TOOLS.md](./TOOLS.md) | Full tool reference |
| [VERIFICATION.md](./VERIFICATION.md) | Audit / stranger verify flow |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Production deploy for `mcp.veyanet.tech` |
| [CONFIGURATION.md](./CONFIGURATION.md) | Environment variable reference |
| [TRANSPORT.md](./TRANSPORT.md) | HTTP / MCP transport |
| [AUTHENTICATION.md](./AUTHENTICATION.md) | Write auth and key custody |
| [SDK_BRIDGE.md](./SDK_BRIDGE.md) | SDK methods used by tools |
