import {
  MCP_SERVICE_NAME,
  MCP_SERVICE_VERSION,
  type McpServiceConfig,
} from "./config.js";

/** Canonical public paste URL — always advertise this on the homepage. */
export const CANONICAL_PUBLIC_MCP_URL = "https://mcp.veyanet.tech/mcp";

/**
 * Brand-aligned GET / page for mcp.veyanet.tech (and local operators).
 * Public Streamable HTTP URL is primary; loopback is secondary ops detail.
 */
export function renderLandingHtml(cfg: McpServiceConfig): string {
  const publicUrl = CANONICAL_PUBLIC_MCP_URL;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>VEYA MCP · @veyanet/mcp</title>
  <meta name="description" content="Public Streamable HTTP MCP for VEYA on Robinhood Chain testnet. Paste into Claude or Cursor."/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --ink: #00141E;
      --paper: #F4F4F0;
      --accent: #7C3AED;
      --muted: rgba(0, 20, 30, 0.62);
      --line: rgba(0, 20, 30, 0.1);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Space Grotesk", system-ui, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(900px 480px at 50% -10%, rgba(124, 58, 237, 0.14), transparent 60%),
        linear-gradient(180deg, var(--paper) 0%, #fff 55%, var(--paper) 100%);
    }
    .grid {
      position: fixed;
      inset: 0;
      opacity: 0.035;
      pointer-events: none;
      background-image:
        linear-gradient(var(--ink) 1px, transparent 1px),
        linear-gradient(90deg, var(--ink) 1px, transparent 1px);
      background-size: 56px 56px;
    }
    main {
      position: relative;
      max-width: 42rem;
      margin: 0 auto;
      padding: 4.5rem 1.5rem 3rem;
    }
    .eyebrow {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--accent);
      margin: 0 0 1rem;
    }
    h1 {
      font-size: clamp(2.4rem, 7vw, 3.4rem);
      line-height: 1.05;
      letter-spacing: -0.04em;
      font-weight: 700;
      margin: 0 0 0.35rem;
    }
    .pkg {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 0.85rem;
      color: var(--muted);
      margin: 0 0 1.5rem;
    }
    .lead {
      font-size: 1.05rem;
      line-height: 1.55;
      color: var(--muted);
      margin: 0 0 2rem;
      max-width: 36rem;
    }
    .paste {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0.95rem 1.2rem;
      box-shadow: 0 10px 30px rgba(0, 20, 30, 0.04);
      margin-bottom: 0.85rem;
    }
    .paste code {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 0.82rem;
      word-break: break-all;
      flex: 1;
    }
    .dot {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 50%;
      background: var(--accent);
      flex-shrink: 0;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin: 1.5rem 0 2.25rem;
    }
    a.btn {
      text-decoration: none;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 0.75rem 1.1rem;
      border-radius: 999px;
      border: 1px solid var(--line);
      color: var(--ink);
      background: #fff;
    }
    a.btn.primary {
      background: var(--ink);
      color: #fff;
      border-color: var(--ink);
    }
    a.btn:hover { border-color: var(--accent); color: var(--accent); }
    a.btn.primary:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
    .honesty {
      border-top: 1px solid var(--line);
      padding-top: 1.35rem;
      font-size: 0.88rem;
      line-height: 1.55;
      color: var(--muted);
    }
    .honesty strong { color: var(--ink); font-weight: 600; }
    .meta {
      margin-top: 1.25rem;
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 0.72rem;
      color: var(--muted);
      display: grid;
      gap: 0.35rem;
    }
  </style>
</head>
<body>
  <div class="grid" aria-hidden="true"></div>
  <main>
    <p class="eyebrow">Model Context Protocol</p>
    <h1>VEYA</h1>
    <p class="pkg">${MCP_SERVICE_NAME}@${MCP_SERVICE_VERSION}</p>
    <p class="lead">
      Paste one public URL into Claude or Cursor. Reads are free.
      Product tools need a site API key. On-chain writes spend YOUR testnet ETH.
    </p>

    <div class="paste" title="Public Streamable HTTP endpoint">
      <span class="dot" aria-hidden="true"></span>
      <code id="mcp-url">${publicUrl}</code>
    </div>

    <div class="actions">
      <a class="btn primary" href="https://veyanet.tech/mcp">Docs on veyanet.tech</a>
      <a class="btn" href="/health">Health JSON</a>
      <a class="btn" href="https://api.veyanet.tech/health">API health</a>
    </div>

    <div class="honesty">
      <p>
        <strong>Public paste URL</strong> is always <code>${publicUrl}</code>.
      </p>
      <p>
        <strong>Consensus / sealed fleet</strong> capacity is owned by the product API
        (<code>api.veyanet.tech</code>). Unreachable capacity returns fail-closed results
        (no invented quorum). Strangers do not run private validator ports.
      </p>
      <p>
        <strong>Reads</strong> need no key. <strong>Product tools</strong> need a
        <code>veya_dev_</code> / <code>veya_live_</code> key from the product site.
        <strong>On-chain writes</strong> spend <em>your</em> wallet — not the hosted relayer.
        Empty wallet: you don't have testnet tokens; please get them for the transaction
        (<a href="https://faucet.testnet.chain.robinhood.com/">Robinhood testnet faucet</a>).
        Guest Build on the product API stays <strong>403</strong> by design.
      </p>
    </div>

    <div class="meta">
      <span>settlement · Robinhood Chain testnet 46630</span>
      <span>contract · ${cfg.contractAddress}</span>
      <span>product API · https://api.veyanet.tech</span>
    </div>
  </main>
</body>
</html>`;
}
