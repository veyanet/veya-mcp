# Transport — `@veyanet/mcp`

How bytes move between an MCP client and this server. Cryptography is not defined here; see [ARCHITECTURE.md](./ARCHITECTURE.md) and [SDK_BRIDGE.md](./SDK_BRIDGE.md).

Source of truth: `src/http.ts`, `src/landingPage.ts`, `src/cli.ts`.

---

## Table of contents

1. [What clients speak](#1-what-clients-speak)
2. [Public connector](#2-public-connector)
3. [HTTP endpoints](#3-http-endpoints)
4. [POST /mcp (stateless — the product path)](#4-post-mcp-stateless--the-product-path)
5. [POST /mcp/session (optional)](#5-post-mcpsession-optional)
6. [GET /health](#6-get-health)
7. [GET / landing](#7-get--landing)
8. [Headers that matter](#8-headers-that-matter)
9. [CORS](#9-cors)
10. [Body size and timeouts](#10-body-size-and-timeouts)
11. [How to probe](#11-how-to-probe)

---

## 1. What clients speak

`@veyanet/mcp` implements **MCP Streamable HTTP**.

That means:

- Clients open **HTTPS** to a URL.
- They `POST` JSON-RPC MCP messages (`initialize`, `tools/list`, `tools/call`, …).
- The response may be ordinary JSON **or** `text/event-stream` (SSE). Smoke tests in this repo accept both.

`veya-mcp` / `npx -y @veyanet/mcp` starts this **HTTP** server on `PORT`. Chain JSON-RPC is `@veyanet/sdk`. Product REST is `https://api.veyanet.tech`. For local operator tests you can POST `http://127.0.0.1:8788/mcp`. Production paste URL stays `https://mcp.veyanet.tech/mcp`.

Package used for the protocol: `@modelcontextprotocol/sdk` (`StreamableHTTPServerTransport`, `McpServer`).

---

## 2. Public connector

```text
https://mcp.veyanet.tech/mcp
```

Paste that into Claude or Cursor as a **Streamable HTTP** MCP server. That is the stranger path.

Related URLs:

| URL | Role |
|-----|------|
| `https://mcp.veyanet.tech/` | Human landing HTML |
| `https://mcp.veyanet.tech/health` | Honesty JSON |
| `https://mcp.veyanet.tech/mcp` | Tool calls |
| `https://api.veyanet.tech` | Product API (not MCP transport) |
| `https://veyanet.tech/mcp` | Marketing / docs page |

---

## 3. HTTP endpoints

| Method | Path | Auth | Role |
|--------|------|------|------|
| `GET` | `/` | None | Landing HTML. Always tells humans to paste `https://mcp.veyanet.tech/mcp`. |
| `GET` | `/health` | None | Honesty JSON (version, chain id, writes flag, sealed claim). |
| `POST` | `/mcp` | None (keys are tool args) | **Primary** Streamable HTTP. Stateless. |
| `POST` | `/mcp/session` | None | Optional session-id transport map. |

Public paste URL is `https://mcp.veyanet.tech/mcp`.

---

## 4. POST /mcp (stateless — the product path)

This is what `https://mcp.veyanet.tech/mcp` hits.

For **each** request, `src/http.ts` does:

1. `createMcpServer(cfg)` — **new** tool registry every time.
2. `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined` (no session id).
3. `server.connect(transport)` then `transport.handleRequest(req, res, req.body)`.
4. On `res.close`, close transport and server.

Writes take `apiKey` and `payerPrivateKey` as **tool arguments**, not HTTP Bearer.

Why stateless? Public paste URL, many clients, no sticky sessions required. In-process Boundnet policy (`veya_set_tool_policy`) lives only for that request’s process lifetime — and because the **server object is discarded**, in-process policy does **not** survive across requests on `POST /mcp`. Hosted Boundnet (`veya_boundnet_invoke`) is the product API table; that **does** persist.

If you need policy that lasts, use the **product API** Boundnet tools, not the in-process SDK map, when talking to the public URL.

Errors that escape the handler return HTTP 500 JSON-RPC:

```json
{
  "jsonrpc": "2.0",
  "error": { "code": -32603, "message": "Internal server error" },
  "id": null
}
```

---

## 5. POST /mcp/session (optional)

Some clients send `mcp-session-id`.

- If the id is known, the stored transport handles the body.
- If there is **no** id and the body is an MCP `initialize`, a new transport is created with `sessionIdGenerator: () => randomUUID()` and stored in a process `Map`.
- Otherwise HTTP 400 JSON-RPC `No valid MCP session`.

Sessions die when the transport closes. This path is **not** the advertised public paste URL. Prefer `POST /mcp` unless your client requires session ids.

---

## 6. GET /health

Example public check:

```bash
curl -s https://mcp.veyanet.tech/health
```

Shape (fields from code):

| Field | Meaning |
|-------|---------|
| `status` | `"ok"` if the MCP process is up (not a fleet check) |
| `service` | `@veyanet/mcp` |
| `version` | `1.2.3` (from `MCP_SERVICE_VERSION`) |
| `publicMcpUrl` | From `PUBLIC_MCP_URL` env |
| `chainId` | Configured pin (should be `46630`) |
| `contractAddress` | `Veya.sol` |
| `writesEnabled` | `true` (user-paid write tools registered) |
| `operatorRelayerWrites` | `false` (user-paid writes never use the host relayer) |
| `sealed` | `"AES-256-GCM (not FHE)"` (exact health string from the process) |
| `settlement` | `"Robinhood Chain testnet 46630"` |

This is **MCP process** health. Product fleet health is `veya_api_health` → `GET https://api.veyanet.tech/health`.

---

## 7. GET / landing

`renderLandingHtml` always sets the copy-paste URL to `CANONICAL_PUBLIC_MCP_URL` (`https://mcp.veyanet.tech/mcp`), not `cfg.host:cfg.port`. Operators can run Node on a private port; humans still see the public URL.

Landing may mention whether writes are enabled on **this** process. It must not print keys.

---

## 8. Headers that matter

| Header | Who sends it | Why |
|--------|--------------|-----|
| `Content-Type: application/json` | Client | Express JSON parser |
| `Accept: application/json, text/event-stream` | Client | Streamable HTTP may SSE |
| `Authorization: Bearer …` | unused for user-paid writes | leftover header; writes use tool `apiKey` |
| `mcp-session-id` | Client | Only `/mcp/session` |
| `Origin` | Browsers | CORS (see below) |

Product API keys are tool argument `apiKey`. MCP then attaches `X-Api-Key` toward the product API.

---

## 9. CORS

`cors` middleware:

- **No `Origin`** (typical native MCP connectors) → allowed.
- `CORS_ORIGIN` empty → any browser Origin is **rejected** (`cb(null, false)`).
- `CORS_ORIGIN` comma list → only those origins, `credentials: true`.

`.env.example` suggests `https://veyanet.tech,https://www.veyanet.tech,https://app.veyanet.tech` for browser demos. Connectors that are not browsers do not need this.

---

## 10. Body size and timeouts

| Limit | Where |
|-------|--------|
| JSON body **1 MB** | `express.json({ limit: "1mb" })` |
| Product API fetch **20 s** | `apiRequest` |
| `veya_api_health` **8 s** | `public.ts` |

There is no request-queue in this package. Scale with more Node processes behind the reverse proxy if needed.

---

## 11. How to probe

Health:

```bash
curl -s https://mcp.veyanet.tech/health
```

A full `initialize` + `tools/list` smoke exists as `npm run smoke` in this repo (starts an in-process app on an ephemeral port). Use that when you operate a checkout. Public users can `curl` health and call tools through Claude or Cursor.

Related: [QUICKSTART.md](./QUICKSTART.md), [VERIFICATION.md](./VERIFICATION.md), [DEPLOYMENT.md](./DEPLOYMENT.md).
