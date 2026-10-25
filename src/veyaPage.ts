/**
 * Shared page shell for VEYA service pages (api.veyanet.tech, mcp.veyanet.tech).
 * Mirrors the landing site (veyanet/src/index.css + Navbar + Footer): Inter / JetBrains Mono,
 * ink #00141E, accent #7C3AED → #8B5CF6, hero-surface lavender background with dot + grid,
 * label-style nav, rounded-full gradient CTA, white rounded-2xl cards, compact ink footer.
 * Same file is used in veya-mcp/src and veya-api-host/backend/src/lib.
 */
import { VEYA_ICONS } from "./veyaIcons.js";

export type NavKey = "api" | "mcp";

/** Landing IconBadge (soft variant, md): 44px tile, real VeyaIcon SVG at 24px. */
export function icon(name: string): string {
  const svg = VEYA_ICONS[name];
  if (!svg) throw new Error(`Unknown VEYA icon: ${name}`);
  return `<div class="ico">${svg}</div>`;
}

export const APP_URL = "https://app.veyanet.tech";
export const KEY_PLACEHOLDER = "veya_live_••••••••";

/** Real flow from veyanet-ui: /login → sidebar System → API Keys (/app/api-keys) → Create → copy once. */
export function keySteps(): string {
  return `<ol class="steps">
<li><span>Open <b>app.veyanet.tech</b> and <b>connect your wallet</b> on the sign-in page.</span></li>
<li><span>In the sidebar, under <b>System</b>, open <b>API Keys</b>.</span></li>
<li><span>Under <b>Create API key</b>, enter a name (for example “Production MCP”), choose <b>Dev</b> or <b>Live</b>, and click <b>Create</b>.</span></li>
<li><span><b>Copy the secret right away.</b> It is shown once. Dev keys start with <code>veya_dev_</code>, live keys with <code>veya_live_</code>.</span></li>
</ol>`;
}

export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
  );
}

export const SITE = "https://www.veyanet.tech";
export const API_URL = "https://api.veyanet.tech";
export const MCP_URL = "https://mcp.veyanet.tech/mcp";

/** Light, on-theme code block. Tokens: k = key/keyword, s = string, p = punctuation, c = command. */
export function codeBlock(label: string, html: string, copyText: string): string {
  return `<div class="code"><div class="code-h"><span>${esc(label)}</span><button type="button" class="copy" data-copy="${esc(copyText)}">Copy</button></div><pre>${html}</pre></div>`;
}

export function networkLabel(network: string): string {
  return network === "mainnet" ? "Mainnet" : "Testnet";
}

const CSS = `
:root{--ink:#00141E;--ink60:rgba(0,20,30,.6);--ink45:rgba(0,20,30,.45);--accent:#7C3AED;--accent2:#8B5CF6;--accent3:#A78BFA;--lav:#faf8ff;--line:rgba(0,20,30,.06);--aline:rgba(124,58,237,.15);--shadow:0 20px 40px rgba(0,20,30,.08)}
*{box-sizing:border-box}html{-webkit-font-smoothing:antialiased}
body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;color:var(--ink);background:#fff}
a{color:inherit}
.hero{position:relative;overflow:hidden;background-color:var(--lav);background-image:radial-gradient(ellipse 80% 55% at 50% 42%,rgba(124,58,237,.1) 0%,transparent 72%),linear-gradient(180deg,#fff 0%,#faf8ff 45%,#f5f0ff 100%),radial-gradient(circle at 1px 1px,rgba(124,58,237,.08) 1px,transparent 0);background-size:100% 100%,100% 100%,22px 22px}
.hero::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(124,58,237,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(124,58,237,.04) 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(ellipse 70% 60% at 50% 45%,#000 20%,transparent 75%);mask-image:radial-gradient(ellipse 70% 60% at 50% 45%,#000 20%,transparent 75%);pointer-events:none}
.hero>*{position:relative;z-index:1}
nav{display:flex;align-items:center;justify-content:space-between;height:80px;padding:0 48px;background:rgba(250,248,255,.92);backdrop-filter:blur(12px);border-bottom:1px solid rgba(124,58,237,.08);position:sticky;top:0;z-index:10}
nav .logo img{height:72px;width:auto;display:block}
.links{display:flex;gap:32px;align-items:center}
.label,.links a{font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase}
.links a{text-decoration:none;color:rgba(0,20,30,.7);transition:color .3s}.links a:hover,.links a.on{color:var(--accent)}
.cta{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#7C3AED 0%,#8B5CF6 100%);color:#fff!important;padding:12px 22px;border-radius:999px;text-decoration:none;box-shadow:var(--shadow);font-weight:600;font-size:14px}
.cta.sm{padding:10px 20px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase}
.ghost{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--aline);color:var(--ink);padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px}
.ghost:hover{border-color:rgba(124,58,237,.35);color:var(--accent)}
.wrap{max-width:1152px;margin:0 auto;padding:0 48px}
.head{text-align:center;padding:72px 0 56px;max-width:820px;margin:0 auto}
.badge{display:inline-flex;align-items:center;gap:8px;font-size:10px;font-weight:700;color:var(--accent);background:rgba(255,255,255,.9);border:1px solid var(--aline);padding:7px 14px;border-radius:999px;text-transform:uppercase;letter-spacing:.15em;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.badge i{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px rgba(139,92,246,.18)}
h1{font-size:58px;font-weight:700;line-height:1.06;letter-spacing:-.03em;margin:26px 0 18px}
.grad{background:linear-gradient(135deg,#7C3AED 0%,#8B5CF6 50%,#A78BFA 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.sub{font-size:18px;line-height:1.6;color:var(--ink60);font-weight:500;margin:0 auto 30px;max-width:680px}
.row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.pillbar{display:flex;align-items:center;gap:12px;border:1px solid rgba(124,58,237,.2);background:rgba(124,58,237,.08);border-radius:999px;padding:12px 18px;max-width:620px;margin:0 auto 22px}
.pillbar .label{color:var(--accent);font-size:10px;letter-spacing:.15em}
.pillbar code{flex:1;text-align:left;font-family:"JetBrains Mono",monospace;font-weight:600;font-size:14px}
.pillbar button,.copy{border:0;background:none;color:var(--accent);font:700 10px Inter,sans-serif;letter-spacing:.15em;text-transform:uppercase;cursor:pointer}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:0 0 72px}
.stat{background:rgba(255,255,255,.75);border:1px solid var(--line);border-radius:16px;padding:20px 22px;text-align:left}
.stat .label{color:var(--ink45);font-size:10px;letter-spacing:.15em}
.stat b{display:flex;align-items:center;gap:8px;font-size:22px;font-weight:700;letter-spacing:-.02em;margin-top:8px}
.dot{width:9px;height:9px;border-radius:50%;background:#14B8A6;box-shadow:0 0 0 4px rgba(20,184,166,.15)}.dot.warn{background:#F59E0B;box-shadow:0 0 0 4px rgba(245,158,11,.15)}
section.band{padding:88px 0;background-color:#fff;background-image:radial-gradient(circle at 1px 1px,rgba(124,58,237,.07) 1px,transparent 0);background-size:20px 20px;position:relative}
section.band::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(124,58,237,.2) 50%,transparent)}
.sh{text-align:center;max-width:640px;margin:0 auto 48px}.sh .label{color:var(--accent)}
h2{font-size:40px;font-weight:700;letter-spacing:-1px;line-height:1.2;margin:14px 0 12px}
.sh p{color:var(--ink60);font-size:16px;line-height:1.6;margin:0}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.grid.two{grid-template-columns:repeat(2,1fr)}
.card{background:rgba(255,255,255,.7);border:1px solid var(--line);border-radius:16px;padding:28px;transition:all .3s}
.card:hover{background:#fff;box-shadow:var(--shadow);border-color:var(--aline);transform:translateY(-4px)}
.card.accent{background:#fff;border-color:var(--aline);box-shadow:var(--shadow)}
.ico{width:44px;height:44px;border-radius:12px;background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.12);display:flex;align-items:center;justify-content:center;margin-bottom:20px;flex-shrink:0}
.keyflow{display:grid;grid-template-columns:1.05fr 1fr;gap:28px;align-items:start}
.steps{list-style:none;margin:0;padding:0;counter-reset:s}
.steps li{counter-increment:s;display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--line);font-size:15px;line-height:1.55;color:var(--ink60)}
.steps li:last-child{border:0}.steps li b{color:var(--ink)}
.steps li::before{content:counter(s);flex-shrink:0;width:28px;height:28px;border-radius:999px;background:linear-gradient(135deg,#7C3AED,#8B5CF6);color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}
.note{font-size:13px;color:var(--ink45);margin:14px 0 0;line-height:1.6}
.ptable{width:100%;border-collapse:collapse;margin-top:12px;font-size:13.5px}.ptable th{text-align:left;color:var(--ink45);font-weight:600;padding:8px 6px;border-bottom:1px solid rgba(124,58,237,.15)}.ptable td{padding:10px 6px;vertical-align:top;border-bottom:1px solid rgba(124,58,237,.08)}.ptable code{font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--accent)}
.stack{display:grid;gap:16px}
.faq{max-width:860px;margin:0 auto;display:grid;gap:12px}
.faq details{background:rgba(255,255,255,.8);border:1px solid var(--line);border-radius:16px;padding:0 24px}
.faq details[open]{background:#fff;border-color:var(--aline);box-shadow:var(--shadow)}
.faq summary{list-style:none;cursor:pointer;padding:20px 0;font-weight:600;font-size:16px;display:flex;justify-content:space-between;gap:16px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";color:var(--accent);font-weight:500;font-size:22px;line-height:1}
.faq details[open] summary::after{content:"–"}
.faq .a{padding:0 0 20px;color:var(--ink60);font-size:15px;line-height:1.65}
.faq .a code,.steps code,.note code,.sh code{font-family:"JetBrains Mono",monospace;font-size:12.5px;color:var(--accent);background:rgba(124,58,237,.06);padding:2px 6px;border-radius:6px}
.card h3{font-size:18px;font-weight:700;margin:0 0 8px}.card p{font-size:14px;line-height:1.6;color:var(--ink60);margin:0 0 14px}
.path{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--accent);background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.12);padding:5px 10px;border-radius:8px}
.code{background:var(--lav);border:1px solid var(--aline);border-radius:12px;overflow:hidden}
.code-h{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid rgba(124,58,237,.1);background:rgba(255,255,255,.7);font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:var(--ink45)}
.code pre{margin:0;padding:16px 18px;font-family:"JetBrains Mono",monospace;font-size:13px;line-height:1.7;color:var(--ink);white-space:pre-wrap;word-break:break-all}
.code .k{color:#7C3AED}.code .s{color:#0D9488}.code .p{color:rgba(0,20,30,.4)}.code .c{color:#6D28D9;font-weight:500}
footer{background:#00141E;border-top:1px solid rgba(255,255,255,.1);padding:22px 48px}
footer .in{display:flex;align-items:center;justify-content:space-between;gap:20px}
footer .mark{display:inline-flex;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);border-radius:16px;padding:10px 16px;box-shadow:0 0 40px -8px rgba(139,92,246,.55)}
footer .mark img{height:32px;width:auto;display:block}
footer .fl{display:flex;gap:24px}footer .fl a{color:rgba(255,255,255,.6);text-decoration:none;font-size:14px}footer .fl a:hover{color:#fff}
footer p{text-align:center;color:rgba(255,255,255,.4);font-size:12px;margin:16px 0 0}
`;

export function renderPage(opts: {
  title: string;
  description: string;
  active: NavKey | "root";
  logoSrc: string;
  logoLightSrc: string;
  hero: string;
  body: string;
}): string {
  const on = (k: string) => (opts.active === k ? ' class="on"' : "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(opts.title)}</title><meta name="description" content="${esc(opts.description)}"/>
<link rel="icon" type="image/png" href="${opts.logoSrc}"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>${CSS}</style></head><body>
<nav><a class="logo" href="${SITE}" aria-label="VEYA"><img src="${opts.logoSrc}" alt="VEYA"/></a>
<div class="links"><a href="${SITE}/features">Platform</a><a href="${SITE}/sdk">SDK</a><a href="${MCP_URL}"${on("mcp")}>MCP</a><a href="${API_URL}"${on("api")}>API</a><a href="${SITE}/proof">Proof</a><a href="${SITE}/docs">Docs</a></div>
<a class="cta sm" href="https://app.veyanet.tech">Open App</a></nav>
<header class="hero">${opts.hero}</header>
${opts.body}
<footer><div class="in"><a class="mark" href="${SITE}" aria-label="VEYA"><img src="${opts.logoLightSrc}" alt="VEYA"/></a>
<div class="fl"><a href="${SITE}/architecture">Architecture</a><a href="${SITE}/sdk">SDK</a><a href="${SITE}/mcp">MCP</a><a href="${SITE}/security">Security</a><a href="${SITE}/docs">Docs</a><a href="${SITE}/proof">Proof</a></div>
<div class="fl"><a href="https://github.com/veyanet">GitHub</a><a href="https://x.com/withveya">X</a></div></div>
<p>&copy; 2026 VEYA. All rights reserved. Independent project, not affiliated with Robinhood.</p></footer>
<script>document.addEventListener("click",function(e){var b=e.target.closest("[data-copy]");if(!b)return;navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function(){var t=b.textContent;b.textContent="Copied";setTimeout(function(){b.textContent=t},1600)})});</script>
</body></html>`;
}
