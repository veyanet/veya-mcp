import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunRecord } from "./state.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const yes = (b: boolean) => (b ? `<span class="ok">yes</span>` : `<span class="no">no</span>`);

/** Static receipt page (light VEYA theme). Holds hashes and links only, never the prompt or full output. */
export function renderReceiptHtml(r: RunRecord): string {
  const e = r.evidence as Record<string, any>;
  const short = (v?: string) => (v && v.length > 24 ? `${v.slice(0, 10)}…${v.slice(-8)}` : v);
  const link = (href?: string, label?: string) => (href ? `<a href="${esc(href)}" title="${esc(label)}" rel="noopener">${esc(short(label ?? href))}</a>` : "—");
  const val = (v?: string) => (v ? `<code>${esc(v)}</code>` : "—");
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="/assets/veya-logo-light.png"><title>VEYA receipt ${esc(r.runId)}</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#f7f8fc;color:#0f172a;margin:0}main{max-width:760px;margin:40px auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px}
h1{font-size:22px;margin:0 0 4px}.sub{color:#64748b;margin-bottom:24px}table{width:100%;border-collapse:collapse}td{padding:8px 6px;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:14px}td:first-child{color:#64748b;width:38%}
code{font-size:12px;word-break:break-all}.ok{color:#047857;font-weight:600}.no{color:#b91c1c;font-weight:600}.badge{display:inline-block;padding:4px 10px;border-radius:999px;background:#eef2ff;color:#4338ca;font-weight:600}a{color:#4f46e5}</style></head>
<body><main><img src="/assets/veya-logo.png" alt="VEYA" height="28" style="margin-bottom:12px"><h1>VEYA run receipt</h1><div class="sub">VEYA Paid Call Guard · agent resource call checked by VEYA policy, verified, and recorded on Robinhood Chain</div>
<table>
<tr><td>Run</td><td><code>${esc(r.runId)}</code></td></tr>
<tr><td>Final state</td><td><span class="badge">${esc(r.state)}</span></td></tr>
<tr><td>Policy decision</td><td>${esc((r.decision as any)?.allow ? "allowed" : `blocked: ${(r.decision as any)?.code ?? ""}`)}</td></tr>
<tr><td>Resource</td><td>${esc(r.resourceId)}</td></tr>
<tr><td>Response received</td><td>${yes(r.statuses.responseReceived)}</td></tr>
<tr><td>Payment verified (Solana, finalized)</td><td>${yes(r.statuses.paymentVerified)}</td></tr>
<tr><td>VEYA record anchored</td><td>${yes(r.statuses.veyaRecordAnchored)}</td></tr>
<tr><td>Payment</td><td>${link(e.solscanUrl, e.paymentSig)}</td></tr>
<tr><td>Payer path</td><td>${esc(e.payer ?? "—")}</td></tr>
<tr><td>Payer fee settlement</td><td>${link(e.feeSolscanUrl, e.feeSig)}</td></tr>
<tr><td>Validators</td><td>${esc(e.quorum ? `${e.quorum.agreed} of ${e.quorum.nodes.length} agreed (need ${e.quorum.threshold})` : "—")}</td></tr>
<tr><td>Result hash (BLAKE3)</td><td>${val(e.resultHash)}</td></tr>
<tr><td>Commitment</td><td>${val(e.commitment)}</td></tr>
<tr><td>VEYA record</td><td>${link(e.blockscoutUrl, e.veyaTx)}</td></tr>
</table>${(r.decision as any)?.allow ? `<p class="sub" style="margin-top:20px">This is cross-chain evidence: the payment settles on Solana and VEYA anchors a commitment on Robinhood Chain afterwards. It is not one atomic cross-chain transaction, and it does not prove the resource's answer is correct.</p>` : `<p class="sub" style="margin-top:20px">VEYA policy stopped this call before anything was signed.</p>`}</main></body></html>`;
  return html;
}

/** Public view of a run: decision, statuses, proof links. No prompt, input or output content. */
export function publicReceipt(r: RunRecord) {
  const e = r.evidence as Record<string, any>; const d = r.decision as any;
  return {
    runId: r.runId, resourceId: r.resourceId, state: r.state,
    decision: d?.allow ? "allowed" : "blocked", reason: d?.allow ? undefined : d?.code,
    statuses: r.statuses,
    payment: e.paymentSig ? { signature: e.paymentSig, solscan: e.solscanUrl } : undefined,
    secondSettlement: e.feeSig ? { signature: e.feeSig, solscan: e.feeSolscanUrl } : undefined,
    validators: e.quorum ? { agreed: e.quorum.agreed, of: e.quorum.nodes.length, threshold: e.quorum.threshold } : undefined,
    resultHash: e.resultHash, commitment: e.commitment,
    veyaRecord: e.veyaTx ? { tx: e.veyaTx, blockscout: e.blockscoutUrl } : undefined,
  };
}

export function writeReceipt(dir: string, r: RunRecord): string {
  mkdirSync(dir, { recursive: true });
  const html = renderReceiptHtml(r);
  const p = join(dir, `${r.runId}.html`);
  writeFileSync(p, html);
  writeFileSync(join(dir, `${r.runId}.json`), JSON.stringify(r, null, 2));
  return p;
}
