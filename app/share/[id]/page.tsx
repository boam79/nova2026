import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadShareDocument } from "../../../lib/share-load";
import { isRunId } from "../../../lib/run-id";
import { shareMarkdown, shareRawPath } from "../../../lib/share";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return {
    title: "NOVA 대화록",
    robots: { index: false, follow: false },
    description: isRunId(id) ? "공개 샘플 증례 대화록" : "없음",
  };
}

export default async function SharePage({ params }: Props) {
  const { id } = await params;
  if (!isRunId(id)) notFound();
  const doc = await loadShareDocument(id);
  if (!doc) notFound();
  const md = shareMarkdown(doc);
  return (
    <main>
      <h1>NOVA 대화록 · {doc.candidate || ""}</h1>
      <p className="hint">
        로그인 없이 대화록만 공개합니다. 공식 점수가 아닙니다.{" "}
        <a href={shareRawPath(id)}>원문(텍스트)</a>
      </p>
      <pre className="share-doc">{md}</pre>
    </main>
  );
}
