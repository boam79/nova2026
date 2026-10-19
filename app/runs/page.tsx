"use client";

import { useEffect, useState } from "react";
import { Disclaimer, Nav } from "../../components/Nav";
import { isActiveRunStatus } from "../../lib/durable-run";
import type { RunMeta } from "../../lib/types";

export default function RunsPage() {
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/runs");
    const data = await res.json();
    setRuns(data.runs || []);
  }

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      const res = await fetch("/api/runs");
      const data = await res.json();
      if (stop) return;
      const list = (data.runs || []) as RunMeta[];
      setRuns(list);
      if (list.some((r) => isActiveRunStatus(r.status))) timer = setTimeout(tick, 3000);
    }
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  async function remove(id: string) {
    if (!confirm("이 실행 기록을 삭제할까요?")) return;
    const res = await fetch(`/api/runs/${id}`, { method: "DELETE" });
    if (!res.ok) setError("삭제 실패");
    else load();
  }

  return (
    <main>
      <Nav />
      <h1>기록</h1>
      <Disclaimer />
      {error ? <p className="bad">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>시각</th>
            <th>후보</th>
            <th>증례</th>
            <th>상태</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.createdAt).toLocaleString("ko-KR")}</td>
              <td>
                <a href={`/runs/${r.id}`}>{r.candidate}</a>
              </td>
              <td>
                {r.cases
                  .map((c) => (r.repsByCase?.[c] ? `${c}×${r.repsByCase[c]}` : c))
                  .join(", ")}
              </td>
              <td>{r.status}</td>
              <td>
                <a href={`/runs/${r.id}`}>열람</a>{" "}
                <button type="button" className="secondary" onClick={() => remove(r.id)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs.length === 0 ? <p className="hint">아직 기록이 없습니다.</p> : null}
    </main>
  );
}
