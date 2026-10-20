import { NextResponse } from "next/server";
import { isRunId } from "../../../../lib/run-id";
import { loadShareDocument } from "../../../../lib/share-load";
import { shareMarkdown } from "../../../../lib/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isRunId(id)) {
    return new NextResponse("없음\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
    });
  }
  const doc = await loadShareDocument(id);
  if (!doc) {
    return new NextResponse("없음\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
    });
  }
  return new NextResponse(shareMarkdown(doc), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "public, max-age=60",
    },
  });
}
