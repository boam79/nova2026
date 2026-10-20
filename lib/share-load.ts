import { getPrivateBuffer, listPrefix } from "./blob.ts";
import { assertNoSecrets } from "./mask.ts";
import { isRunId } from "./run-id.ts";
import { loadMeta, runPrefix } from "./sandbox-run.ts";
import type { ShareDocument } from "./share.ts";

export async function loadShareDocument(id: string): Promise<ShareDocument | null> {
  if (!isRunId(id)) return null;
  const meta = await loadMeta(id);
  if (!meta) return null;
  const prefix = `${runPrefix(meta)}transcripts/`;
  const blobs = await listPrefix(prefix);
  const txts = blobs
    .filter((b) => b.pathname.endsWith(".txt"))
    .sort((a, b) => a.pathname.localeCompare(b.pathname));
  const transcripts: ShareDocument["transcripts"] = [];
  for (const blob of txts) {
    const buf = await getPrivateBuffer(blob.pathname);
    if (!buf) continue;
    const label = blob.pathname.split("/").pop()?.replace(/\.txt$/, "") || "";
    if (!label) continue;
    transcripts.push({ case: label, text: buf.toString("utf8") });
  }
  const doc: ShareDocument = {
    id: meta.id,
    candidate: meta.candidate,
    status: meta.status,
    mode: meta.mode,
    createdAt: meta.createdAt,
    doctorModel: meta.doctorModel,
    patientModel: meta.patientModel,
    transcripts,
  };
  assertNoSecrets(doc);
  return doc;
}
