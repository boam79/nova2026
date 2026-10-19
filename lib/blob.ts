import { BlobStoreSuspendedError, del, get, list, put } from "@vercel/blob";
import {
  BLOB_METRICS_PATH,
  emptyBlobOps,
  mergeBlobOps,
  recordBlobOp,
  takeBlobOpsDelta,
  type BlobOpSnapshot,
} from "./blob-ops.ts";

const privateAccess = { access: "private" as const };

async function rawGetBuffer(pathname: string): Promise<Buffer | null> {
  const res = await get(pathname, { ...privateAccess, useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  const ab = await new Response(res.stream).arrayBuffer();
  return Buffer.from(ab);
}

async function rawPutJson(pathname: string, value: unknown): Promise<void> {
  await put(pathname, JSON.stringify(value), {
    ...privateAccess,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function flushBlobOps(): Promise<void> {
  const delta = takeBlobOpsDelta();
  if (!delta.list && !delta.put && !delta.get && !delta.del) return;
  const buf = await rawGetBuffer(BLOB_METRICS_PATH);
  let base = emptyBlobOps;
  if (buf) {
    try {
      const parsed = JSON.parse(buf.toString("utf8")) as Partial<BlobOpSnapshot>;
      base = mergeBlobOps(emptyBlobOps, {
        list: Number(parsed.list || 0),
        put: Number(parsed.put || 0),
        get: Number(parsed.get || 0),
        del: Number(parsed.del || 0),
        advanced: 0,
        simple: 0,
      });
    } catch {
      base = emptyBlobOps;
    }
  }
  const next = mergeBlobOps(base, delta);
  await rawPutJson(BLOB_METRICS_PATH, { ...next, updatedAt: new Date().toISOString() });
}

export async function readPersistedBlobOps(): Promise<{ totals: BlobOpSnapshot; suspended: boolean }> {
  try {
    const buf = await rawGetBuffer(BLOB_METRICS_PATH);
    if (!buf) return { totals: emptyBlobOps, suspended: false };
    const parsed = JSON.parse(buf.toString("utf8")) as Partial<BlobOpSnapshot>;
    return {
      totals: mergeBlobOps(emptyBlobOps, {
        list: Number(parsed.list || 0),
        put: Number(parsed.put || 0),
        get: Number(parsed.get || 0),
        del: Number(parsed.del || 0),
        advanced: 0,
        simple: 0,
      }),
      suspended: false,
    };
  } catch (err) {
    if (err instanceof BlobStoreSuspendedError) return { totals: emptyBlobOps, suspended: true };
    throw err;
  }
}

export async function putPrivate(pathname: string, body: Buffer | string | Blob, contentType?: string) {
  recordBlobOp("put");
  const result = await put(pathname, body, {
    ...privateAccess,
    addRandomSuffix: false,
    allowOverwrite: true,
    ...(contentType ? { contentType } : {}),
  });
  await flushBlobOps().catch(() => undefined);
  return result;
}

export async function getPrivateBuffer(pathname: string): Promise<Buffer | null> {
  recordBlobOp("get");
  return rawGetBuffer(pathname);
}

export async function listPrefix(prefix: string) {
  const out = [];
  let cursor: string | undefined;
  do {
    recordBlobOp("list");
    const page = await list({ prefix, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export async function deletePrefix(prefix: string) {
  const blobs = await listPrefix(prefix);
  if (blobs.length) {
    recordBlobOp("del");
    await del(blobs.map((b) => b.url));
  }
  await flushBlobOps().catch(() => undefined);
}

export { privateAccess };
