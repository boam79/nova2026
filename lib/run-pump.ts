import type { RunMeta, RunStatus } from "./types.ts";

function timingSafeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

export const PUMP_HEADER = "x-nova-pump";
export const PUMP_BUDGET_MS = 240_000;
export const PUMP_TICK_MS = 1_500;
export const PUMP_STALE_MS = 20_000;
export const PUMP_LAUNCH_GRACE_MS = 15_000;

export function shouldKeepPumping(status: RunStatus | string | undefined): boolean {
  return status === "queued" || status === "running";
}

/** 브라우저가 POST /api/runs를 끊어도 샌드박스를 멈추지 않는다. */
export function shouldStopOnClientDisconnect(): boolean {
  return false;
}

export function startDisconnectAction(): "ignore" | "stop" {
  return shouldStopOnClientDisconnect() ? "stop" : "ignore";
}

export function hasLiveSandbox(sandboxId: string | undefined): boolean {
  return Boolean(sandboxId);
}

export function needsPumpKick(
  meta: Pick<RunMeta, "status" | "sandboxId" | "pumpedAt" | "createdAt" | "launching">,
  now = Date.now(),
): boolean {
  if (!shouldKeepPumping(meta.status)) return false;
  if (!meta.sandboxId) {
    const created = Date.parse(meta.createdAt);
    if (Number.isFinite(created) && now - created < PUMP_LAUNCH_GRACE_MS) return false;
    return true;
  }
  const at = meta.pumpedAt ? Date.parse(meta.pumpedAt) : 0;
  if (!Number.isFinite(at) || at <= 0) return true;
  return now - at > PUMP_STALE_MS;
}

export function pumpBudgetLeft(startedAt: number, now = Date.now(), budgetMs = PUMP_BUDGET_MS): number {
  return budgetMs - (now - startedAt);
}

export function shouldChainPump(status: RunStatus | string | undefined, remainingMs: number): boolean {
  return shouldKeepPumping(status) && remainingMs <= 0;
}

export function verifyPumpSecret(header: string | null | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  return timingSafeEqual(header, secret);
}

export function isContinuePath(pathname: string): boolean {
  return /^\/api\/runs\/[^/]+\/continue$/.test(pathname);
}
