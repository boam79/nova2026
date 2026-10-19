export const ACTIVE_RUN_STORAGE_KEY = "nova_active_run";
export const CONTINUE_HEADER = "x-nova-continue";
export const PUMP_SLICE_MS = 45_000;
export const PUMP_INTERVAL_MS = 3_000;
export const QUEUE_STALE_MS = 90_000;

export type PumpAction = "wait" | "poll" | "reenqueue" | "finish";

export function isActiveRunStatus(status: string | undefined): boolean {
  return status === "queued" || status === "running";
}

export function shouldResumePoll(status: string | undefined): boolean {
  return isActiveRunStatus(status);
}

export function resumeRunView(input: {
  urlRunId?: string | null;
  storedRunId?: string | null;
}): { runId: string; poll: true } | null {
  const id = String(input.urlRunId || "").trim() || String(input.storedRunId || "").trim();
  if (!id) return null;
  return { runId: id, poll: true };
}

export function continuePayload(runId: string): string {
  return `continue.${runId}`;
}

export function isContinuePath(pathname: string): boolean {
  return /^\/api\/runs\/[^/]+\/continue$/.test(pathname);
}

export function planPumpTick(input: {
  status?: string;
  hasSandbox?: boolean;
  sliceElapsedMs: number;
  maxSliceMs?: number;
}): PumpAction {
  if (!isActiveRunStatus(input.status)) return "finish";
  if (input.sliceElapsedMs >= (input.maxSliceMs ?? PUMP_SLICE_MS)) return "reenqueue";
  if (!input.hasSandbox) return "wait";
  return "poll";
}

export async function queueRunAndContinue<Q, L>(opts: {
  signal?: AbortSignal;
  queue: () => Promise<Q>;
  scheduleAfter: (work: () => Promise<void>) => void;
  launch: (queued: Q) => Promise<L>;
  pump: (queued: Q, launched: L) => Promise<void>;
}): Promise<Q> {
  void opts.signal;
  const queued = await opts.queue();
  opts.scheduleAfter(async () => {
    const launched = await opts.launch(queued);
    await opts.pump(queued, launched);
  });
  return queued;
}
