import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { recordBlobOp } from "../../../../lib/blob-ops.ts";
import { flushBlobOps } from "../../../../lib/blob.ts";

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("uploads/")) {
          throw new Error("bad_path");
        }
        return {
          allowedContentTypes: [
            "application/zip",
            "application/x-zip-compressed",
            "application/octet-stream",
          ],
          maximumSizeInBytes: 50_000_000,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        recordBlobOp("put");
        await flushBlobOps().catch(() => undefined);
      },
    });
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json({ error: String((error as Error).message || error) }, { status: 400 });
  }
}
