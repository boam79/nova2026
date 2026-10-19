import { after, NextResponse } from "next/server";
import { verifySignedPayload } from "../../../../../lib/auth";
import { CONTINUE_HEADER, continuePayload, isActiveRunStatus } from "../../../../../lib/durable-run";
import { enqueuePump } from "../../../../../lib/run-pump";
import { loadMeta, pumpRun } from "../../../../../lib/sandbox-run";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const secret = process.env.AUTH_SECRET || "";
  const token = req.headers.get(CONTINUE_HEADER) || "";
  const ok = await verifySignedPayload(secret, continuePayload(id), token);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const meta = await loadMeta(id);
  if (!meta) return NextResponse.json({ error: "없음" }, { status: 404 });
  if (!isActiveRunStatus(meta.status)) {
    return NextResponse.json({ ok: true, status: meta.status });
  }
  const origin = new URL(req.url).origin;
  after(async () => {
    await pumpRun(id, (runId) => enqueuePump(runId, origin));
  });
  return NextResponse.json({ ok: true, status: meta.status });
}
