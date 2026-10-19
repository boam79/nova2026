import { OPENAI_BASE, clampRep } from "./constants.ts";
import type { RunMode } from "./types.ts";

/** 키가 있으면 실제 모델. 키가 없으면 재연. 드롭다운만 실제 모델이고 키가 비면 호출하지 않는다. */
export function resolveRunMode(_requested: string | undefined, apiKey: string): RunMode {
  return apiKey.trim() ? "api" : "replay";
}

export function formatRepsArg(cases: string[], repsByCase: Record<string, number>): string {
  return cases.map((c) => `${c}=${clampRep(repsByCase[c] ?? 1)}`).join(",");
}

export function runnerLaunchArgs(opts: {
  cases: string[];
  reps?: number;
  repsByCase?: Record<string, number>;
  doctorModel: string;
  patientModel: string;
  mode: RunMode;
}): { args: string[]; offline: boolean; passKeys: boolean } {
  const repsArg = opts.repsByCase
    ? formatRepsArg(opts.cases, opts.repsByCase)
    : String(clampRep(opts.reps ?? 1));
  const args = [
    "/vercel/sandbox/nova_local_runner.py",
    "--zip",
    "/vercel/sandbox/submission.zip",
    "--cases",
    opts.cases.join(","),
    "--reps",
    repsArg,
    "--base-url",
    OPENAI_BASE,
    "--doctor-model",
    opts.doctorModel,
    "--patient-model",
    opts.patientModel,
  ];
  const passKeys = opts.mode === "api";
  const offline = !passKeys;
  if (offline) args.push("--offline");
  return { args, offline, passKeys };
}
