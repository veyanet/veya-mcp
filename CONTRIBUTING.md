# Contributing — `@veyanet/mcp`

1. Build sibling SDK first: `cd ../sdk && npm install && npm run build`
2. `npm install && npm run lint && npm test && npm run smoke`
3. Keep public tool output honest (testnet 46630, AES-256-GCM, not FHE/mainnet)
4. Never commit `.env` or funded keys
5. Prefer fail-closed writes (Bearer + relayer key)

Security reports: **security@veyanet.tech** (see [SECURITY.md](./SECURITY.md)).
