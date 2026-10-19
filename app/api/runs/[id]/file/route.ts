import { NextResponse } from "next/server";
import { getPrivateBuffer } from "../../../../../lib/blob";
import { loadMeta, runPrefix } from "../../../../../lib/sandbox-run";

export const runtime = "nodejs";

const ALLOWED = new Set(["summary.json", "result.zip"]);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const meta = await loadMeta(id);
  if (!meta) return NextResponse.json({ error: "없음" }, { status: 404 });
  const url = new URL(req.url);
  const name = url.searchParams.get("name") || "";
  const caseId = url.searchParams.get("case") || "";
  let pathname = "";
  let type = "application/octet-stream";
  const prefix = runPrefix(meta);
  if (name === "summary.json") {
    pathname = `${prefix}summary.json`;
    type = "application/json";
  } else if (name === "result.zip") {
    pathname = `${prefix}result.zip`;
    type = "application/zip";
  } else if (name === "transcript.json" && caseId) {
    pathname = `${prefix}transcripts/${caseId}.json`;
    type = "application/json";
  } else if (name === "transcript.txt" && caseId) {
    pathname = `${prefix}transcripts/${caseId}.txt`;
    type = "text/plain; charset=utf-8";
  } else if (!ALLOWED.has(name) && !name.startsWith("transcript")) {
    return NextResponse.json({ error: "bad_file" }, { status: 400 });
  }
  if (!pathname) return NextResponse.json({ error: "bad_file" }, { status: 400 });
  const buf = await getPrivateBuffer(pathname);
  if (!buf) return NextResponse.json({ error: "없음" }, { status: 404 });
  const filename = pathname.split("/").pop() || "file";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
