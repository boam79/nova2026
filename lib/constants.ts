export const OPENAI_BASE = "https://api.openai.com/v1";
export const BLOCKED_HOST = /snubhai|nova\./i;
export const CASES = ["C01", "C03", "C10"] as const;
export type CaseId = (typeof CASES)[number];

export const MAX_ZIP_BYTES = 50_000_000;
export const MAX_UNPACKED_BYTES = 500_000_000;
export const MAX_ZIP_ENTRIES = 5000;
export const CALL_LIMIT_DEFAULT = 200;
export const MAX_CONCURRENT_RUNS = 3;
export const TURN_LIMIT = 50;
export const KEY_SESSION = "nova_web_keys";
export const GATE_COOKIE = "nova_web_gate";

export const EXTERNAL_STRINGS = [
  "openrouter",
  "groq.com",
  "api.openai.com",
  "anthropic.com",
  "generativelanguage",
  "huggingface.co",
  "localhost:11434",
  "snubhai",
];

export const TEXT_EXT = new Set([
  ".py",
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".cfg",
]);

export const MODELS = ["gpt-6-luna", "gpt-6.1-sol"] as const;
export type ModelId = (typeof MODELS)[number];
export const DEFAULT_DOCTOR_MODEL: ModelId = "gpt-6-luna";
export const DEFAULT_PATIENT_MODEL: ModelId = "gpt-6-luna";

export function asModelId(value: string | undefined, fallback: ModelId): ModelId {
  return (MODELS as readonly string[]).includes(value || "") ? (value as ModelId) : fallback;
}

export function estimateCalls(mode: "replay" | "api", caseCount: number, reps: number, callLimit = 200): number {
  if (mode === "replay") return 0;
  return Math.min(callLimit, Math.max(1, caseCount) * Math.max(1, reps) * 60);
}
