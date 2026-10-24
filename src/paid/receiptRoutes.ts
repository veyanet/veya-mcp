import type { Express } from "express";
import { join } from "node:path";
import { Ledger } from "./state.js";
import { PAID_ROOT } from "./config.js";
import { renderReceiptHtml, publicReceipt } from "./receipt.js";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Read-only receipt pages: GET /receipts/paid/:runId (HTML) and /receipts/paid/:runId.json (public fields only). */
export function mountPaidReceipts(app: Express, stateDir = process.env.VEYA_PAID_STATE_DIR || join(PAID_ROOT, "state")) {
  app.get("/receipts/paid/:id", (req, res) => {
    const raw = String(req.params.id); const asJson = raw.endsWith(".json"); const id = asJson ? raw.slice(0, -5) : raw;
    if (!RUN_ID.test(id)) return res.status(400).type("text").send("bad run id");
    const r = new Ledger(stateDir).run(id); // re-read each time: the ledger file is the source of truth
    if (!r) return res.status(404).type("text").send("receipt not found");
    res.set("Cache-Control", "no-store").set("X-Content-Type-Options", "nosniff");
    if (asJson) return res.json(publicReceipt(r));
    res.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'").type("html").send(renderReceiptHtml(r));
  });
}
