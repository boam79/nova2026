import { NextResponse } from "next/server";
import { loadBlobUsage } from "../../../lib/blob-usage";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const report = await loadBlobUsage();
  return NextResponse.json(report, {
    headers: { "Cache-Control": "no-store" },
  });
}
