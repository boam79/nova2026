import type { CaseId } from "./constants";

export type RunMode = "replay" | "api";
export type RunStatus = "queued" | "running" | "done" | "error" | "stopped";

export type ProgressEvent = {
  kind: string;
  turn: number;
  calls: number;
  doctor: string;
  patient: string;
  case?: string;
  ok?: boolean;
};

export type RunMeta = {
  id: string;
  createdAt: string;
  candidate: string;
  zipPath: string;
  cases: CaseId[];
  reps: number;
  repsByCase?: Partial<Record<CaseId, number>>;
  mode: RunMode;
  doctorModel: string;
  patientModel: string;
  callLimit: number;
  status: RunStatus;
  sandboxId: string;
  error?: string;
  summary?: unknown;
  /** 공식 대화록을 이미 저장한 증례. 진행 중 기록으로 다시 덮지 않는다. */
  archived?: string[];
  /** 공식 대화록을 한 번 찾아 본 증례. */
  officialTried?: string[];
  /** 마지막으로 대화록에 반영한 진행 줄 수. */
  progressLines?: number;
  disclaimer: string;
};
