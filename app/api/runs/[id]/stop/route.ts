import { NextResponse } from "next/server";
import { loadMeta, stopRun } from "../../../../../lib/sandbox-run";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = await loadMeta(id);
  if (!meta) return NextResponse.json({ error: "없음" }, { status: 404 });
  const stopped = await stopRun(meta);
  return NextResponse.json({ meta: stopped });
}
