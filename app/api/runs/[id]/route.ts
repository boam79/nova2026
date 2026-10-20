import { after, NextResponse } from "next/server";
import { chainPump, deleteRun, loadMeta, runPrefix } from "../../../../lib/sandbox-run";
import { maskText } from "../../../../lib/mask";
import { getPrivateBuffer } from "../../../../lib/blob";
import { needsPumpKick } from "../../../../lib/run-pump";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const meta = await loadMeta(id);
    if (!meta) return NextResponse.json({ error: "없음" }, { status: 404 });
    if (needsPumpKick(meta)) {
      after(() => chainPump(id));
    }
    const summaryBuf = await getPrivateBuffer(`${runPrefix(meta)}summary.json`);
    const progressBuf = await getPrivateBuffer(`${runPrefix(meta)}progress.jsonl`);
    const progress = progressBuf
      ? progressBuf
          .toString("utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
      : [];
    return NextResponse.json({
      meta,
      progress,
      summary: summaryBuf ? JSON.parse(summaryBuf.toString("utf8")) : meta.summary,
    });
  } catch (err) {
    return NextResponse.json(
      { error: maskText(String((err as Error).message || err)) },
      { status: 503 },
    );
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = await loadMeta(id);
  if (!meta) return NextResponse.json({ error: "없음" }, { status: 404 });
  await deleteRun(meta);
  return NextResponse.json({ ok: true });
}
