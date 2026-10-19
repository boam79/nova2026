import type { Transcript, Turn } from "./summary";
import type { ProgressEvent } from "./types";

export type BuiltDialogue = {
  label: string;
  closed: boolean;
  ok: boolean;
  doc: Transcript & { partial?: boolean };
};

export function isSandboxStoppedPayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed.split("\n")[0]) as { error?: { code?: string } };
    return parsed?.error?.code === "sandbox_stopped";
  } catch {
    return trimmed.includes('"sandbox_stopped"');
  }
}

export function isSandboxStoppedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return isSandboxStoppedPayload(msg) || msg.includes("sandbox_stopped");
}

export function usableProgress(events: ProgressEvent[]): ProgressEvent[] {
  return events.filter((event) => event.kind === "case_start" || event.kind === "case_end" || event.kind === "say" || event.kind === "exam");
}

export function transcriptsFromProgress(events: ProgressEvent[]): BuiltDialogue[] {
  let current = "";
  const groups = new Map<string, { turns: Turn[]; closed: boolean; ok: boolean }>();
  for (const event of usableProgress(events)) {
    if (event.kind === "case_start") {
      current = event.case || current || "진행";
      if (!groups.has(current)) groups.set(current, { turns: [], closed: false, ok: false });
      continue;
    }
    if (event.kind === "case_end") {
      const label = event.case || current || "진행";
      const group = groups.get(label) || { turns: [], closed: false, ok: false };
      group.closed = true;
      group.ok = event.ok !== false;
      groups.set(label, group);
      if (current === label) current = "";
      continue;
    }
    const label = current || "진행";
    const group = groups.get(label) || { turns: [], closed: false, ok: false };
    group.turns.push({
      action: event.kind === "exam" ? "EXAM" : "SAY",
      content: event.doctor,
      response: event.patient,
    });
    groups.set(label, group);
  }
  return [...groups.entries()].map(([label, group]) => ({
    label,
    closed: group.closed,
    ok: group.ok,
    doc: { turns: group.turns, partial: !group.closed },
  }));
}
