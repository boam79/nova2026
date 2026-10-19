import { NextResponse } from "next/server";
import { getPrivateBuffer } from "../../../../lib/blob";
import { validateSubmissionZip } from "../../../../lib/zip-validate";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { pathname?: string };
  if (!body.pathname || !body.pathname.startsWith("uploads/")) {
    return NextResponse.json({ error: "pathname" }, { status: 400 });
  }
  const buf = await getPrivateBuffer(body.pathname);
  if (!buf) return NextResponse.json({ error: "파일을 찾지 못했습니다." }, { status: 404 });
  const result = await validateSubmissionZip(buf, buf.byteLength);
  return NextResponse.json(result);
}
