import type { CaseId } from "./constants";

export type RunMode = "replay" | "api";
export type RunStatus = "queued" | "running" | "done" | "error" | "stopped";

export type ProgressEvent = {
  kind: string;
  turn: number;
  calls: number;
  doctor: string;
  patient: string;
};

export type RunMeta = {
  id: string;
  createdAt: string;
  candidate: string;
  zipPath: string;
  cases: CaseId[];
  reps: number;
  mode: RunMode;
  doctorModel: string;
  patientModel: string;
  callLimit: number;
  status: RunStatus;
  sandboxId: string;
  error?: string;
  summary?: unknown;
  disclaimer: string;
};
