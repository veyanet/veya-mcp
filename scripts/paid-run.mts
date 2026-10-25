/** Server-side helper: read / resume / reconcile a run. Never pays. Usage: paid-run.mts <runId> [resume] */
import { buildGuardFromEnv } from "../src/paid/tools.js";
const [runId, mode] = process.argv.slice(2);
const p = buildGuardFromEnv();
const r = p.ledger.run(runId);
if (!r) { console.log("unknown run"); process.exit(1); }
const out = mode === "resume" ? (r.state === "resource_error" ? await p.reconcile(runId) : await p.resume(runId)) : p.view(r);
console.log(JSON.stringify(out, null, 2));
