# HTTP Transport — VEYA MCP

## Protocol

`@veyanet/mcp` implements **MCP Streamable HTTP** using `@modelcontextprotocol/sdk`’s `StreamableHTTPServerTransport`.

Public clients (Claude, Cursor) should configure:

* Transport: Streamable HTTP (HTTP)
* URL: `https://mcp.veyanet.tech/mcp`

## Endpoints

### `GET /`

Minimal HTML landing page: paste URL, local POST hint, health link, honesty line (testnet 46630 · AES-256-GCM · not mainnet), pointer to stdio sibling path for operators.

### `GET /health`

JSON honesty probe. Does not require MCP session. Safe to scrape from uptime monitors.

Example shape:

```json
{
  "status": "ok",
  "service": "@veyanet/mcp",
  "version": "1.0.0",
  "publicMcpUrl": "https://mcp.veyanet.tech/mcp",
  "chainId": 46630,
  "contractAddress": "0x1a1Dc3c55550FCE9F70ef6cDEeF967c0b72a5d84",
  "writesEnabled": false,
  "sealed": "AES-256-GCM (not FHE)",
  "settlement": "Robinhood Chain testnet 46630"
}
```

### `POST /mcp`

Stateless Streamable HTTP handler. Typical Accept header from clients:

```http
Accept: application/json, text/event-stream
Content-Type: application/json
```

Body is JSON-RPC MCP messages (initialize, tools/list, tools/call, …). Response may be JSON or SSE (`text/event-stream`) depending on client/transport negotiation.

Each request constructs an MCP server instance, connects a transport, handles the request, and closes on response end.

### `POST /mcp/session`

Optional path for clients that use `MCP-Session-Id`. Initialize without a session id creates a session; subsequent calls reuse the transport map. Prefer `/mcp` for simple paste-URL clients unless your client requires sessions.

## CORS

Configured in `createHttpApp`:

* No `Origin` → allowed (server-side connectors)
* `Origin` present → must be listed in `CORS_ORIGIN`
* Credentials enabled for allowlisted origins

## Proxy requirements

When placing nginx (or similar) in front:

1. `proxy_http_version 1.1`
2. Forward `Authorization`
3. Forward `X-Forwarded-Proto`
4. `proxy_buffering off` for streaming responses
5. Reasonable body size (MCP JSON is small; Express limit is `1mb`)

## Timeouts

Tool handlers that call RPC or `api.veyanet.tech` use short fetch timeouts (e.g. 8s for API health). Upstream proxy idle timeouts should exceed typical tool latency (recommend ≥ 60s).

## Local debugging

```bash
npm start
curl -s http://127.0.0.1:8788/health
npm run smoke
```

Smoke exercises initialize + tools/list + tool calls against an ephemeral listen port.

## What this transport is not

* Not stdio MCP (see Anchor package)
* Not Server-Sent Events only (Streamable HTTP may use SSE framing but is not a raw EventSource API for operators to scrape manually)
* Not WebSocket MCP
