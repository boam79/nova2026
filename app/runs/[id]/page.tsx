"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Disclaimer, Nav } from "../../../components/Nav";
import { ShareBox } from "../../../components/ShareBox";

type Row = {
  case: string;
  partial?: boolean;
  turns?: number;
  history?: number;
  exams?: number;
  dx?: string;
  dup?: number;
  over30?: number;
  fidelity?: string;
  doctor?: string;
};

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<{
    meta?: { candidate: string; status: string; error?: string; cases: string[]; mode?: string };
    summary?: { rows?: Row[] };
    progress?: { kind: string; turn: number; doctor: string; patient: string; case?: string; ok?: boolean }[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const res = await fetch(`/api/runs/${id}`);
      const json = await res.json();
      if (cancelled) return;
      setData(json);
      const st = json.meta?.status;
      if (st === "queued" || st === "running") setTimeout(tick, 1200);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const rows = data?.summary?.rows || [];
  const cases = rows.map((r) => r.case).filter(Boolean);

  return (
    <main>
      <Nav />
      <h1>결과 {data?.meta?.candidate || ""}</h1>
      <Disclaimer />
      <ShareBox id={id} />
      <p className="hint">
        요청 모드: {data?.meta?.mode === "api" ? "실제 모델" : data?.meta?.mode === "replay" ? "재연" : "—"}
        {data?.meta?.status === "queued" || data?.meta?.status === "running"
          ? " · 실행 중(창을 닫아도 서버에서 이어 갑니다)."
          : ""}
        . 대화록의 의사/환자 칸이 replay·bank이면 모델 왕복이 없습니다.
      </p>
      {data?.meta?.error ? <p className="bad">{data.meta.error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>증례</th>
            <th>턴</th>
            <th>문진</th>
            <th>진찰</th>
            <th>진단</th>
            <th>중복</th>
            <th>30자 초과</th>
            <th>재현</th>
            <th>의사</th>
            <th>환자</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.case}>
              <td>
                {r.case}
                {r.partial ? " (끊김)" : ""}
              </td>
              <td>{r.turns}</td>
              <td>{r.history}</td>
              <td>{r.exams}</td>
              <td>{r.dx}</td>
              <td>{r.dup}</td>
              <td>{r.over30}</td>
              <td>{r.fidelity}</td>
              <td>{r.doctor || "?"}</td>
              <td>{r.fidelity === "API" ? "api" : "bank"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <a className="btn" href={`/api/runs/${id}/file?name=summary.json`}>
          summary.json
        </a>{" "}
        <a className="btn" href={`/api/runs/${id}/file?name=result.zip`}>
          결과 ZIP
        </a>
      </p>
      {cases.map((c) => (
        <p key={c}>
          {c}{" "}
          <a href={`/api/runs/${id}/file?name=transcript.json&case=${encodeURIComponent(c)}`}>JSON</a> ·{" "}
          <a href={`/api/runs/${id}/file?name=transcript.txt&case=${encodeURIComponent(c)}`}>텍스트</a>
        </p>
      ))}
      <h2>대화</h2>
      <div className="turns">
        {(data?.progress || []).map((p, i) =>
          p.kind === "case_start" ? (
            <p key={i} className="case-mark">
              {p.case} 시작
            </p>
          ) : p.kind === "case_end" ? (
            <p key={i} className={p.ok === false ? "case-mark bad" : "case-mark end"}>
              {p.case} 끝
            </p>
          ) : p.kind === "say" || p.kind === "exam" ? (
            <p key={i}>
              [{p.kind} {p.turn}] 의사: {p.doctor}
              <br />
              환자: {p.patient}
            </p>
          ) : null,
        )}
      </div>
    </main>
  );
}
