import { NextResponse } from "next/server";
import { fetchOpenAIBalance } from "../../../lib/openai-balance";
import { assertNoSecrets } from "../../../lib/mask";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { apiKey?: string; doctorKey?: string };
  const apiKey = String(body.apiKey || body.doctorKey || "");
  const report = await fetchOpenAIBalance(apiKey);
  assertNoSecrets(report, [apiKey]);
  return NextResponse.json(report, {
    headers: { "Cache-Control": "no-store" },
  });
}
