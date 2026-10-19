import { NextResponse } from "next/server";
import { CASES, CALL_LIMIT_DEFAULT, DEFAULT_DOCTOR_MODEL, DEFAULT_PATIENT_MODEL, MAX_CONCURRENT_RUNS, clampRep } from "../../../lib/constants";
import { listMetas, lockSnapshot, startRun } from "../../../lib/sandbox-run";
import { resolveRunMode } from "../../../lib/run-mode";
import { BusyError } from "../../../lib/run-lock";
import { maskText } from "../../../lib/mask";
import type { CaseId } from "../../../lib/constants";
import type { RunMode } from "../../../lib/types";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function GET() {
  const [runs, concurrent] = await Promise.all([listMetas(), lockSnapshot()]);
  return NextResponse.json({ runs, concurrent });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    zipPath?: string;
    candidate?: string;
    cases?: string[];
    reps?: number;
    repsByCase?: Record<string, number>;
    mode?: RunMode;
    apiKey?: string;
    doctorKey?: string;
    doctorModel?: string;
    patientModel?: string;
    callLimit?: number;
  };
  try {
    if (!body.zipPath) return NextResponse.json({ error: "ZIP이 없습니다." }, { status: 400 });
    const cases = (body.cases || []).filter((c): c is CaseId => (CASES as readonly string[]).includes(c));
    const selected = cases.length ? cases : [...CASES];
    const repsByCase = Object.fromEntries(
      selected.map((c) => [c, clampRep(Number(body.repsByCase?.[c] ?? body.reps ?? 1))]),
    ) as Partial<Record<CaseId, number>>;
    const apiKey = String(body.apiKey || body.doctorKey || "").trim();
    const mode: RunMode = resolveRunMode(body.mode, apiKey);
    if (body.mode === "api" && !apiKey) {
      return NextResponse.json({ error: "실제 모델 모드에는 키가 필요합니다." }, { status: 400 });
    }
    const meta = await startRun({
      zipPath: body.zipPath,
      candidate: body.candidate || "submission",
      cases: selected,
      reps: Math.max(...Object.values(repsByCase)),
      repsByCase,
      mode,
      doctorKey: mode === "api" ? apiKey : "",
      patientKey: mode === "api" ? apiKey : "",
      doctorModel: body.doctorModel || DEFAULT_DOCTOR_MODEL,
      patientModel: body.patientModel || DEFAULT_PATIENT_MODEL,
      callLimit: body.callLimit || CALL_LIMIT_DEFAULT,
    });
    return NextResponse.json({ id: meta.id, meta });
  } catch (err) {
    const msg = (err as Error).message;
    if (err instanceof BusyError || msg === "busy") {
      const max = err instanceof BusyError ? err.max : MAX_CONCURRENT_RUNS;
      const inFlight = err instanceof BusyError ? err.inFlight : max;
      return NextResponse.json(
        {
          error: `이미 실행이 ${max}개입니다. 하나가 끝난 뒤 다시 시작해 주세요.`,
          inFlight,
          max,
        },
        { status: 409 },
      );
    }
    if (msg.startsWith("bank_")) {
      return NextResponse.json({ error: "샘플 증례 데이터가 없습니다. 관리자가 bank를 올려야 합니다." }, { status: 500 });
    }
    return NextResponse.json({ error: maskText(msg) }, { status: 500 });
  }
}
