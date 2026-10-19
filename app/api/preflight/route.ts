import { NextResponse } from "next/server";
import { DEFAULT_DOCTOR_MODEL, DEFAULT_PATIENT_MODEL } from "../../../lib/constants";
import { preflightRole } from "../../../lib/openai-preflight";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    apiKey?: string;
    doctorKey?: string;
    doctorModel?: string;
    patientModel?: string;
  };
  const apiKey = String(body.apiKey || body.doctorKey || "");
  const doctorModel = body.doctorModel || DEFAULT_DOCTOR_MODEL;
  const patientModel = body.patientModel || DEFAULT_PATIENT_MODEL;
  if (!apiKey) {
    return NextResponse.json({ ok: true, mode: "replay", results: [] });
  }
  const results = [
    await preflightRole("doctor", apiKey, doctorModel),
    await preflightRole("patient", apiKey, patientModel),
  ];
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, results, mode: "api" });
}
