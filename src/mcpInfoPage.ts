import { MCP_SERVICE_NAME, MCP_SERVICE_VERSION, type McpServiceConfig } from "./config.js";
import { createMcpServer } from "./server.js";
import { codeBlock, esc, icon, keySteps, networkLabel, renderPage, SITE, API_URL, APP_URL, MCP_URL, KEY_PLACEHOLDER } from "./veyaPage.js";

export const CANONICAL_PUBLIC_MCP_URL = MCP_URL;
let cachedToolCount: number | null = null;

/** Counts the tools this build registers at runtime (same server the /mcp transport uses). */
export function registeredToolCount(cfg: McpServiceConfig): number {
  if (cachedToolCount !== null) return cachedToolCount;
  const server = createMcpServer(cfg) as unknown as { _registeredTools?: Record<string, unknown> };
  cachedToolCount = Object.keys(server._registeredTools ?? {}).length;
  return cachedToolCount;
}

/** Browser visit to GET /mcp: Accept prefers text/html and is not an SSE stream request. */
export function wantsHtml(accept: string | undefined): boolean {
  const a = (accept ?? "").toLowerCase();
  return a.includes("text/html") && !a.includes("text/event-stream");
}

const LOGO = "/assets/veya-logo.png";
const LOGO_LIGHT = "/assets/veya-logo-light.png";

function statRow(cfg: McpServiceConfig, toolCount: number): string {
  return `<div class="stats">
<div class="stat"><span class="label">Status</span><b><i class="dot"></i>Operational</b></div>
<div class="stat"><span class="label">Network</span><b>${networkLabel(cfg.network)}</b></div>
<div class="stat"><span class="label">Tools</span><b>${toolCount}</b></div>
<div class="stat"><span class="label">Version</span><b>${esc(MCP_SERVICE_VERSION)}</b></div>
</div>`;
}

function pill(): string {
  return `<div class="pillbar"><span class="label">MCP URL</span><code>${MCP_URL}</code><button type="button" data-copy="${MCP_URL}">Copy</button></div>`;
}

export function setupSnippets(): string {
  const cursor = `<span class="p">{</span>\n  <span class="k">"mcpServers"</span><span class="p">: {</span>\n    <span class="k">"veya"</span><span class="p">: {</span> <span class="k">"url"</span><span class="p">:</span> <span class="s">"${MCP_URL}"</span> <span class="p">}</span>\n  <span class="p">}</span>\n<span class="p">}</span>`;
  const claude = `<span class="c">claude mcp add</span> --transport http veya <span class="p">\\</span>\n  <span class="s">${MCP_URL}</span>`;
  const codex = `<span class="p">[</span><span class="k">mcp_servers.veya</span><span class="p">]</span>\n<span class="k">url</span> <span class="p">=</span> <span class="s">"${MCP_URL}"</span>`;
  const card = (n: string, t: string, where: string, block: string) =>
    `<div class="card accent">${icon(n)}<h3>${t}</h3><p>${where}</p>${block}</div>`;
  return `<div class="grid">
${card("mcp-network", "Cursor", "Add to <code>~/.cursor/mcp.json</code>", codeBlock("mcp.json", cursor, JSON.stringify({ mcpServers: { veya: { url: MCP_URL } } }, null, 2)))}
${card("developers", "Claude Code", "Run once in your terminal", codeBlock("Terminal", claude, `claude mcp add --transport http veya ${MCP_URL}`))}
${card("ai-teams", "Codex", "Add to <code>~/.codex/config.toml</code>", codeBlock("config.toml", codex, `[mcp_servers.veya]\nurl = "${MCP_URL}"`))}
</div>`;
}

const CAPABILITIES: Array<[string, string, string]> = [
  ["settlement-layer", "Prove", "Hash any text or file with BLAKE3 and anchor it on Robinhood Chain."],
  ["verified-execution", "Verify", "Check any receipt from a transaction hash and get an explorer link."],
  ["permission-agents", "Policy", "Allow or deny tools per agent. Deny stays deny."],
  ["encrypted-coordination", "Consensus", "Run work across 2-of-3 validators and anchor the agreed result."],
  ["sealed-lock", "Sealed", "AES-256-GCM sealed execution with ML-DSA signed results."],
  ["protected-execution", "Post-quantum", "ML-DSA keys and signatures, registered onchain."],
];

export function renderMcpInfoHtml(cfg: McpServiceConfig, toolCount: number): string {
  const net = networkLabel(cfg.network);
  const hero = `<div class="wrap"><div class="head">
<span class="badge"><i></i>Live on Robinhood Chain ${net}</span>
<h1>Connect your agent to <span class="grad">VEYA.</span></h1>
<p class="sub">This is the Streamable HTTP endpoint for MCP clients. Add one URL, and your agent can prove work, verify receipts and follow the tools you allow.</p>
${pill()}
<div class="row"><a class="cta" href="${SITE}/mcp">MCP guide →</a><a class="ghost" href="${SITE}/docs">Docs</a><a class="ghost" href="/health">Service health</a></div>
</div>${statRow(cfg, toolCount)}</div>`;
  const body = `<section class="band"><div class="wrap">
<div class="sh"><span class="label">Setup</span><h2>One URL. <span class="grad">Any client.</span></h2><p>Paste the endpoint into your client. Read tools need no key; product tools take your VEYA API key.</p></div>
${setupSnippets()}
</div></section>${keySection()}${faqSection(toolCount)}`;
  return renderPage({ title: "VEYA MCP · Setup", description: "Connect any AI agent to VEYA on Robinhood Chain with one MCP URL.", active: "mcp", logoSrc: LOGO, logoLightSrc: LOGO_LIGHT, hero, body });
}

/** API key section: real app flow + how the MCP takes the key (tool argument, per veya-skills). */
export function keySection(): string {
  const call = `<span class="p">{</span>\n  <span class="k">"name"</span><span class="p">:</span> <span class="s">"veya_list_environments"</span><span class="p">,</span>\n  <span class="k">"arguments"</span><span class="p">: {</span> <span class="k">"apiKey"</span><span class="p">:</span> <span class="s">"${KEY_PLACEHOLDER}"</span> <span class="p">}</span>\n<span class="p">}</span>`;
  return `<section class="band"><div class="wrap">
<div class="sh"><span class="label">API key</span><h2>Get your key from <span class="grad">the VEYA app.</span></h2><p>Read and verify tools work without a key. Product tools take your key as the <code>apiKey</code> argument.</p></div>
<div class="keyflow"><div class="card accent">${icon("scoped-memory")}<h3>Create a key</h3>${keySteps()}<div class="row" style="justify-content:flex-start;margin-top:18px"><a class="cta" href="${APP_URL}">Open the VEYA app →</a></div></div>
<div class="stack">${codeBlock("Tool call with apiKey", call, JSON.stringify({ name: "veya_list_environments", arguments: { apiKey: "YOUR_VEYA_API_KEY" } }, null, 2))}
<p class="note">Your agent passes the key in the <code>apiKey</code> argument only when a tool needs it. The server forwards it to the VEYA API for that call. It is not part of <code>mcp.json</code>, and the hosted endpoint needs no header. Onchain writes also take <code>payerPrivateKey</code> for your own funded wallet, and the agent asks before it sends.</p></div></div>
</div></section>`;
}

export function faqSection(toolCount: number): string {
  const qa: Array<[string, string]> = FAQ(toolCount);
  return `<section class="band"><div class="wrap">
<div class="sh"><span class="label">FAQ</span><h2>Questions, <span class="grad">answered.</span></h2></div>
<div class="faq">${qa.map(([q, a], i) => `<details${i === 0 ? " open" : ""}><summary>${q}</summary><div class="a">${a}</div></details>`).join("")}</div>
</div></section>`;
}

export function FAQ(toolCount: number): Array<[string, string]> {
  return [
    ["What is VEYA MCP?", `A public Model Context Protocol server (<code>${esc(MCP_SERVICE_NAME)}</code>) that gives AI agents ${toolCount} VEYA tools over Streamable HTTP. Your agent can prove work, verify receipts, set tool policies and run verified jobs on Robinhood Chain.`],
    ["How do I connect my client?", `Add <code>${MCP_URL}</code> as a remote MCP server. In Cursor, put <code>{"mcpServers":{"veya":{"url":"${MCP_URL}"}}</code> in <code>~/.cursor/mcp.json</code>. In Claude Code, run <code>claude mcp add --transport http veya ${MCP_URL}</code>. The setup cards above have Codex too.`],
    ["Do I need an API key?", `Not for read and verify tools such as <code>veya_describe</code>, <code>veya_verify_transaction</code> and <code>veya_hash_blake3</code>. Environments, agents, policies, memory, consensus, sealed execution and proof lists need a product key (<code>veya_dev_…</code> or <code>veya_live_…</code>).`],
    ["Where do I get a key?", `At <a href="${APP_URL}">app.veyanet.tech</a>: connect your wallet, open <b>System → API Keys</b>, then create a Dev or Live key. Copy it right away, because the secret is shown once.`],
    ["Which network does it use?", `Robinhood Chain mainnet. Receipts are written to the VEYA contract and link to the Robinhood Chain explorer.`],
    [`What can the ${toolCount} tools do?`, `Hash and prove content with BLAKE3, anchor and verify receipts, create ML-DSA post-quantum keys and signatures, manage environments and agents, allow or deny tools per agent, store scoped memory, run 2-of-3 validator consensus and AES-256-GCM sealed jobs, and read the public registry.`],
    ["Are my keys stored?", `No. <code>apiKey</code> and <code>payerPrivateKey</code> are tool arguments passed per call. They are not part of <code>mcp.json</code>, and VEYA's agent rules say never to echo them back. Onchain writes only send after your wallet matches the key's wallet and you confirm.`],
    ["How do I verify a receipt?", `Ask your agent to run <code>veya_verify_transaction</code> with the transaction hash, open <a href="${APP_URL}/verify">app.veyanet.tech/verify</a>, or call <code>GET ${API_URL}/api/verify/&lt;tx&gt;</code>. A transaction that is not a VEYA receipt returns <code>NOT_VEYA_TX</code>.`],
  ];
}

/** GET / on mcp.veyanet.tech. */
export function renderMcpRootHtml(cfg: McpServiceConfig, toolCount: number): string {
  const net = networkLabel(cfg.network);
  const caps = CAPABILITIES.map(([m, t, d]) => `<div class="card">${icon(m)}<h3>${t}</h3><p>${d}</p></div>`).join("");
  const hero = `<div class="wrap"><div class="head">
<span class="badge"><i></i>${esc(MCP_SERVICE_NAME)} · Model Context Protocol</span>
<h1>Where agents get <span class="grad">tools,</span><br/>boundaries and proof.</h1>
<p class="sub">The VEYA MCP server gives any AI agent ${toolCount} tools for verifiable work on Robinhood Chain ${net}. Onchain writes use <em>your</em> wallet and ask before they send.</p>
${pill()}
<div class="row"><a class="cta" href="/mcp">Set up your client →</a><a class="ghost" href="${SITE}/mcp">MCP guide</a><a class="ghost" href="${API_URL}">VEYA API</a></div>
</div>${statRow(cfg, toolCount)}</div>`;
  const body = `<section class="band"><div class="wrap">
<div class="sh"><span class="label">Capabilities</span><h2>What your agent <span class="grad">can do.</span></h2><p>Every result comes back with a receipt anyone can verify.</p></div>
<div class="grid">${caps}</div>
</div></section>${keySection()}`;
  return renderPage({ title: `VEYA MCP · ${MCP_SERVICE_NAME}`, description: "Public Streamable HTTP MCP for VEYA on Robinhood Chain.", active: "root", logoSrc: LOGO, logoLightSrc: LOGO_LIGHT, hero, body });
}
