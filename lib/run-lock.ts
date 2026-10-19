import { MAX_CONCURRENT_RUNS } from "./constants.ts";

export const LOCK_TTL_MS = 45 * 60 * 1000;

export type LockEntry = { id: string; at: string };
export type LockState = { runs: LockEntry[] };

export class BusyError extends Error {
  readonly inFlight: number;
  readonly max: number;
  constructor(inFlight: number, max: number) {
    super("busy");
    this.name = "BusyError";
    this.inFlight = inFlight;
    this.max = max;
  }
}

export function parseLock(raw: unknown): LockState {
  if (!raw || typeof raw !== "object") return { runs: [] };
  const o = raw as { runs?: unknown; id?: unknown; at?: unknown };
  if (Array.isArray(o.runs)) {
    return {
      runs: o.runs.filter(
        (r): r is LockEntry =>
          Boolean(r) && typeof r === "object" && typeof (r as LockEntry).id === "string",
      ).map((r) => ({ id: r.id, at: typeof r.at === "string" ? r.at : new Date(0).toISOString() })),
    };
  }
  if (typeof o.id === "string") {
    return { runs: [{ id: o.id, at: typeof o.at === "string" ? o.at : new Date(0).toISOString() }] };
  }
  return { runs: [] };
}

export function liveRuns(state: LockState, now: Date, ttlMs = LOCK_TTL_MS): LockEntry[] {
  const t = now.getTime();
  return state.runs.filter((r) => {
    const at = Date.parse(r.at);
    if (!Number.isFinite(at)) return false;
    return t - at < ttlMs;
  });
}

export function admitRun(
  state: LockState,
  runId: string,
  now: Date,
  max = MAX_CONCURRENT_RUNS,
  ttlMs = LOCK_TTL_MS,
): { ok: boolean; state: LockState } {
  const runs = liveRuns(state, now, ttlMs).filter((r) => r.id !== runId);
  if (runs.length >= max) return { ok: false, state: { runs } };
  return { ok: true, state: { runs: [...runs, { id: runId, at: now.toISOString() }] } };
}

export function releaseRun(state: LockState, runId: string): LockState {
  return { runs: state.runs.filter((r) => r.id !== runId) };
}
