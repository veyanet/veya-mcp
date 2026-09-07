# Deployment Guide — VEYA MCP

Production target: **`https://mcp.veyanet.tech/mcp`**  
Package: `@veyanet/mcp` in monorepo directory `robinhood/hosted-mcp/`  
Stdio sibling (not this service): `veya-anchor/packages/mcp/`

## Architecture on the host

```text
Internet → TLS (mcp.veyanet.tech) → nginx → 127.0.0.1:8788 → node dist/cli.js
```

## Build on the server

```bash
cd /opt/veya/sdk   # or your checkout path for robinhood/sdk
npm install && npm run build

cd /opt/veya/mcp   # checkout of robinhood/hosted-mcp
npm install && npm run build
```

Copy `.env.example` → `.env` and edit secrets **on the server only**.

## Required production env

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=8788
PUBLIC_MCP_URL=https://mcp.veyanet.tech/mcp
ROBINHOOD_CHAIN_ID=46630
ROBINHOOD_RPC_URL=https://rpc.testnet.chain.robinhood.com
ROBINHOOD_EXPLORER_URL=https://explorer.testnet.chain.robinhood.com
VEYA_CONTRACT_ADDRESS=0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84
VEYA_API_URL=https://api.veyanet.tech
CORS_ORIGIN=https://veyanet.tech,https://www.veyanet.tech,https://app.veyanet.tech
```

Optional writes:

```bash
MCP_API_KEY=<long-random-secret>
VEYA_RELAYER_PRIVATE_KEY=0x...
```

Leave write vars empty for a public read-only MCP (recommended default until you need agent writes).

## nginx

```nginx
server {
    listen 443 ssl http2;
    server_name mcp.veyanet.tech;
    ssl_certificate     /etc/letsencrypt/live/mcp.veyanet.tech/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.veyanet.tech/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8788;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
        proxy_buffering off;
    }
}
```

**Critical:** forward `Authorization` so Bearer write auth reaches Node. Disable response buffering for Streamable HTTP.

## systemd unit (example)

```ini
[Unit]
Description=VEYA MCP
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/veya/mcp
ExecStart=/usr/bin/node dist/cli.js
EnvironmentFile=/opt/veya/mcp/.env
Restart=always
RestartSec=3
User=veya
Group=veya

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now veya-mcp
sudo systemctl status veya-mcp
```

## Post-deploy checklist

- [ ] `curl -s https://mcp.veyanet.tech/health` → `status: ok`, `chainId: 46630`
- [ ] Landing `/` shows paste URL `https://mcp.veyanet.tech/mcp`
- [ ] Claude / Cursor can connect and call `veya_describe`
- [ ] `veya_ping_chain` returns 46630
- [ ] `veya_verify_transaction` works on a known tx
- [ ] If writes disabled: `/health` has `writesEnabled: false`
- [ ] If writes enabled: Bearer required; wrong Bearer fails
- [ ] `.env` not in git; file mode restricted (`chmod 600`)

## Rollback

1. `systemctl stop veya-mcp`
2. Redeploy previous `dist/` + `.env`
3. `systemctl start veya-mcp`
4. Re-run health + `veya_ping_chain`

## Companion docs

* Tree: `robinhood/docs/phase2/MCP.md`
* Ship board: `robinhood/docs/phase2/SHIP.md` §3b
