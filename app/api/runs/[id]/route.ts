import { NextResponse } from "next/server";
import { deleteRun, loadMeta, readRunProgress, syncRun } from "../../../../lib/sandbox-run";
import { maskText } from "../../../../lib/mask";
import { getPrivateBuffer } from "../../../../lib/blob";
import { runPrefix } from "../../../../lib/sandbox-run";
import { isActiveRunStatus } from "../../../../lib/durable-run";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = await loadMeta(id);
  if (!meta) return NextResponse.json({ error: "없음" }, { status: 404 });
  if (isActiveRunStatus(meta.status)) {
    try {
      const polled = await syncRun(meta);
      const summaryBuf = await getPrivateBuffer(`${runPrefix(polled.meta)}summary.json`);
      return NextResponse.json({
        meta: polled.meta,
        progress: polled.progress,
        log: polled.log,
        summary: summaryBuf ? JSON.parse(summaryBuf.toString("utf8")) : polled.meta.summary,
      });
    } catch (err) {
      const progress = await readRunProgress(meta).catch(() => []);
      return NextResponse.json({
        meta,
        progress,
        log: "",
        error: maskText(String((err as Error).message || err)),
      });
    }
  }
  const summaryBuf = await getPrivateBuffer(`${runPrefix(meta)}summary.json`);
  const progress = await readRunProgress(meta);
  return NextResponse.json({
    meta,
    progress,
    summary: summaryBuf ? JSON.parse(summaryBuf.toString("utf8")) : meta.summary,
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = await loadMeta(id);
  if (!meta) return NextResponse.json({ error: "없음" }, { status: 404 });
  await deleteRun(meta);
  return NextResponse.json({ ok: true });
}
