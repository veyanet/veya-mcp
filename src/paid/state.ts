/** Run ledger: per-task budget (reserved/spent), idempotency, state machine. File-backed, single process. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export type RunState =
  | "prepared" | "denied" | "authorized" | "payment_failed" | "resource_error" | "paid"
  | "payment_unverifiable" | "verified" | "quorum_failed" | "committed" | "commit_failed";

const ALLOWED: Record<RunState, RunState[]> = {
  prepared: ["denied", "authorized"],
  authorized: ["paid", "payment_failed", "resource_error"],
  paid: ["verified", "payment_unverifiable", "resource_error"],
  resource_error: ["payment_unverifiable"],
  payment_unverifiable: ["verified"],
  verified: ["committed", "quorum_failed", "commit_failed"],
  quorum_failed: ["quorum_failed", "committed", "commit_failed"], commit_failed: ["commit_failed", "committed"], committed: [], denied: [], payment_failed: [],
};

export type RunRecord = {
  runId: string; taskId: string; idempotencyKey: string; resourceId: string; state: RunState;
  history: { state: RunState; at: string; note?: string }[];
  reservedAtomic: string; spentAtomic: string; decision?: unknown; evidence: Record<string, unknown>;
  statuses: { responseReceived: boolean; paymentVerified: boolean; veyaRecordAnchored: boolean };
};
type Task = { taskId: string; budgetAtomic: string; reservedAtomic: string; spentAtomic: string; calls: number };
type Db = { tasks: Record<string, Task>; runs: Record<string, RunRecord>; idem: Record<string, string> };

export class Ledger {
  private db: Db;
  constructor(private dir: string, opts: { writer?: boolean } = {}) {
    mkdirSync(dir, { recursive: true });
    if (opts.writer) Ledger.claim(dir);
    const p = join(dir, "ledger.json");
    this.db = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { tasks: {}, runs: {}, idem: {} };
  }
  /**
   * One writing process per state folder. A second process would overwrite the first one's runs.
   * Writes `ledger.lock` with this pid; refuses if another live process holds it.
   */
  static claim(dir: string): void {
    const lock = join(dir, "ledger.lock");
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, "utf8").trim());
      if (pid && pid !== process.pid) {
        let alive = false; try { process.kill(pid, 0); alive = true; } catch { alive = false; }
        if (alive) throw new Error(`STATE_LOCKED: another process (pid ${pid}) is using ${dir}. Use one MCP process per state folder.`);
      }
    }
    writeFileSync(lock, String(process.pid));
  }
  private save() {
    const p = join(this.dir, "ledger.json");
    writeFileSync(p + ".tmp", JSON.stringify(this.db, null, 2));
    renameSync(p + ".tmp", p);
  }
  log(event: string, data: Record<string, unknown>) {
    appendFileSync(join(this.dir, "audit.log"), JSON.stringify({ at: new Date().toISOString(), event, ...data }) + "\n");
  }
  task(taskId: string, budgetAtomic: bigint): Task {
    let t = this.db.tasks[taskId];
    if (!t) { t = this.db.tasks[taskId] = { taskId, budgetAtomic: budgetAtomic.toString(), reservedAtomic: "0", spentAtomic: "0", calls: 0 }; this.save(); }
    return t;
  }
  runByIdem(key: string): RunRecord | undefined { const id = this.db.idem[key]; return id ? this.db.runs[id] : undefined; }
  run(runId: string): RunRecord | undefined { return this.db.runs[runId]; }
  allRuns(): RunRecord[] { return Object.values(this.db.runs); }
  create(r: Omit<RunRecord, "history" | "state" | "reservedAtomic" | "spentAtomic" | "evidence" | "statuses">): RunRecord {
    if (this.db.idem[r.idempotencyKey]) throw new Error("IDEMPOTENCY: key already used");
    const rec: RunRecord = { ...r, state: "prepared", history: [{ state: "prepared", at: new Date().toISOString() }], reservedAtomic: "0", spentAtomic: "0", evidence: {},
      statuses: { responseReceived: false, paymentVerified: false, veyaRecordAnchored: false } };
    this.db.runs[r.runId] = rec; this.db.idem[r.idempotencyKey] = r.runId; this.save();
    this.log("run.prepared", { runId: r.runId, taskId: r.taskId, resourceId: r.resourceId });
    return rec;
  }
  /** Atomic (single-threaded) reserve: synchronous check+write so parallel calls cannot both pass. */
  reserve(taskId: string, runId: string, amount: bigint, maxCalls: number): { ok: true } | { ok: false; reason: string } {
    const t = this.db.tasks[taskId];
    const committed = BigInt(t.reservedAtomic) + BigInt(t.spentAtomic);
    if (t.calls >= maxCalls) return { ok: false, reason: `TASK_CALL_LIMIT: ${t.calls}/${maxCalls} calls used` };
    if (committed + amount > BigInt(t.budgetAtomic)) return { ok: false, reason: `TASK_BUDGET: reserved+spent ${committed} + ${amount} > budget ${t.budgetAtomic}` };
    t.reservedAtomic = (BigInt(t.reservedAtomic) + amount).toString(); t.calls += 1;
    this.db.runs[runId].reservedAtomic = amount.toString(); this.save();
    return { ok: true };
  }
  /** Move reservation to spent (money may have moved) or release it (nothing moved). */
  settle(runId: string, spent: bigint) {
    const r = this.db.runs[runId]; const t = this.db.tasks[r.taskId];
    t.reservedAtomic = (BigInt(t.reservedAtomic) - BigInt(r.reservedAtomic)).toString();
    t.spentAtomic = (BigInt(t.spentAtomic) + spent).toString();
    if (spent === 0n) t.calls = Math.max(0, t.calls - 1);
    r.reservedAtomic = "0"; r.spentAtomic = spent.toString(); this.save();
  }
  /** Correct a settled spend after on-chain reconciliation. */
  rebook(runId: string, actual: bigint) {
    const r = this.db.runs[runId]; const t = this.db.tasks[r.taskId];
    t.spentAtomic = (BigInt(t.spentAtomic) - BigInt(r.spentAtomic) + actual).toString(); r.spentAtomic = actual.toString(); this.save();
  }
  transition(runId: string, to: RunState, note?: string, patch?: Partial<RunRecord>) {
    const r = this.db.runs[runId];
    if (!ALLOWED[r.state].includes(to)) throw new Error(`STATE: illegal ${r.state} -> ${to}`);
    Object.assign(r, patch ?? {}); r.state = to; r.history.push({ state: to, at: new Date().toISOString(), note });
    this.save(); this.log("run." + to, { runId, note });
  }
  update(runId: string, patch: Partial<RunRecord>) { Object.assign(this.db.runs[runId], patch); this.save(); }
  taskView(taskId: string) { return this.db.tasks[taskId]; }
}
