import { isRunId } from "./run-id.ts";

export type ShareTranscript = { case: string; text: string };

export type ShareDocument = {
  id: string;
  candidate: string;
  status: string;
  mode: string;
  createdAt: string;
  doctorModel?: string;
  patientModel?: string;
  transcripts: ShareTranscript[];
};

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/api/login" || pathname === "/robots.txt") return true;
  if (pathname === "/share" || pathname.startsWith("/share/")) return true;
  return false;
}

export function parseShareId(pathname: string): { id: string; raw: boolean } | null {
  const m = pathname.match(/^\/share\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/raw)?$/i);
  if (!m || !isRunId(m[1])) return null;
  return { id: m[1], raw: m[2] === "/raw" };
}

export function sharePath(id: string): string {
  return `/share/${id}`;
}

export function shareRawPath(id: string): string {
  return `/share/${id}/raw`;
}

export function shareMarkdown(doc: ShareDocument): string {
  const mode = doc.mode === "api" ? "실제 모델" : doc.mode === "replay" ? "재연" : doc.mode || "—";
  const lines = [
    `# NOVA 대화록 · ${doc.candidate || "실행"}`,
    "",
    "점수가 아니라 대화록입니다. 공식 점수로 쓰지 마세요.",
    "공개 샘플 증례의 의사-환자 대화입니다. ZIP·키·기록 목록은 이 주소에 없습니다.",
    "",
    `- 실행: ${doc.id}`,
    `- 시각: ${doc.createdAt}`,
    `- 모드: ${mode}`,
    `- 상태: ${doc.status}`,
  ];
  if (doc.doctorModel) lines.push(`- 의사 모델: ${doc.doctorModel}`);
  if (doc.patientModel) lines.push(`- 환자 모델: ${doc.patientModel}`);
  lines.push("");
  if (!doc.transcripts.length) {
    lines.push("아직 대화록이 없습니다. 실행이 끝나면 이 주소에 대화가 채워집니다.");
    lines.push("");
    return lines.join("\n");
  }
  for (const item of doc.transcripts) {
    lines.push(`## ${item.case}`);
    lines.push("");
    lines.push(item.text.trim());
    lines.push("");
  }
  return lines.join("\n");
}
