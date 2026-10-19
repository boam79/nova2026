import JSZip from "jszip";
import {
  EXTERNAL_STRINGS,
  MAX_UNPACKED_BYTES,
  MAX_ZIP_BYTES,
  MAX_ZIP_ENTRIES,
  TEXT_EXT,
} from "./constants.ts";

export type ZipIssue = { level: "ERROR" | "WARN"; message: string };

export type ZipCheck = {
  ok: boolean;
  issues: ZipIssue[];
  files: string[];
  zipBytes: number;
  unpackedBytes: number;
};

const URL_RE = /https?:\/\/([^/\s"'<>)\]]*)/gi;

function extOf(name: string): string {
  const base = name.split("/").pop() || name;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i).toLowerCase() : "";
}

export function zipCentralNames(buf: Uint8Array): string[] {
  const b = Buffer.from(buf);
  const names: string[] = [];
  let i = 0;
  while (i + 46 < b.length) {
    if (b.readUInt32LE(i) !== 0x02014b50) {
      i += 1;
      continue;
    }
    const nameLen = b.readUInt16LE(i + 28);
    const extraLen = b.readUInt16LE(i + 30);
    const commentLen = b.readUInt16LE(i + 32);
    names.push(b.slice(i + 46, i + 46 + nameLen).toString("utf8"));
    i += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function isEscape(name: string): boolean {
  const n = name.replace(/\\/g, "/");
  if (n.startsWith("/") || n.includes(":")) return true;
  for (const p of n.split("/")) {
    if (p === "..") return true;
  }
  return n.includes("..");
}

export async function validateSubmissionZip(buf: ArrayBuffer | Uint8Array, zipBytes: number): Promise<ZipCheck> {
  const issues: ZipIssue[] = [];
  if (zipBytes > MAX_ZIP_BYTES) {
    issues.push({ level: "ERROR", message: `ZIP이 ${MAX_ZIP_BYTES}바이트를 넘습니다.` });
  }

  for (const rawName of zipCentralNames(buf instanceof Uint8Array ? buf : new Uint8Array(buf))) {
    if (isEscape(rawName)) issues.push({ level: "ERROR", message: `경로 탈출 의심: ${rawName}` });
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return { ok: false, issues: [{ level: "ERROR", message: "ZIP을 열 수 없습니다." }], files: [], zipBytes, unpackedBytes: 0 };
  }

  const files: string[] = [];
  let unpacked = 0;
  let entries = 0;
  const names = new Set<string>();

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    entries += 1;
    files.push(name);
    if (isEscape(name)) issues.push({ level: "ERROR", message: `경로 탈출 의심: ${name}` });
    const size = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof size === "number") unpacked += size;
    else {
      const bytes = await entry.async("uint8array");
      unpacked += bytes.byteLength;
    }
    names.add(name.split("/").pop() || name);
  }

  if (entries > MAX_ZIP_ENTRIES) {
    issues.push({ level: "ERROR", message: `파일 ${entries}개 > ${MAX_ZIP_ENTRIES}개` });
  }

  if (!names.has("run.py")) issues.push({ level: "ERROR", message: "루트에 run.py가 없습니다." });
  if (!names.has("nova_sdk.py")) issues.push({ level: "ERROR", message: "루트에 nova_sdk.py가 없습니다." });
  if (!names.has("requirements.txt")) issues.push({ level: "ERROR", message: "루트에 requirements.txt가 없습니다." });

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (!TEXT_EXT.has(extOf(name))) continue;
    const text = await entry.async("string");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const low = line.toLowerCase();
      for (const s of EXTERNAL_STRINGS) {
        if (low.includes(s)) {
          issues.push({ level: "ERROR", message: `${name}:${i + 1} 외부 주소 문자열(${s})` });
        }
      }
      let m: RegExpExecArray | null;
      URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(line))) {
        issues.push({ level: "ERROR", message: `${name}:${i + 1} 주소 ${m[0]}` });
      }
    }
  }

  if (unpacked > MAX_UNPACKED_BYTES) {
    issues.push({ level: "ERROR", message: `해제 후 ${unpacked}바이트가 상한을 넘습니다.` });
  }

  const error = issues.some((x) => x.level === "ERROR");
  return { ok: !error, issues, files, zipBytes, unpackedBytes: unpacked };
}

