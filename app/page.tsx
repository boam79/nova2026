"use client";

import { useEffect, useMemo, useState } from "react";
import { upload } from "@vercel/blob/client";
import { BlobUsagePanel } from "../components/BlobUsagePanel";
import { Disclaimer, Nav } from "../components/Nav";
import {
  CASES,
  CALL_LIMIT_DEFAULT,
  DEFAULT_DOCTOR_MODEL,
  DEFAULT_PATIENT_MODEL,
  KEY_SESSION,
  MAX_CONCURRENT_RUNS,
  MODELS,
  asModelId,
  clampRep,
  estimateCalls,
} from "../lib/constants";
import type { CaseId, ModelId } from "../lib/constants";
import type { ProgressEvent } from "../lib/types";
import { RUN_STORAGE_KEY, restoreRunId, searchWithRunId } from "../lib/run-id";
import { shouldKeepPumping } from "../lib/run-pump";

type ZipState = { pathname: string; name: string; ok: boolean; issues: { level: string; message: string }[] };

export default function RunPage() {
  const [apiKey, setApiKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [doctorModel, setDoctorModel] = useState<ModelId>(DEFAULT_DOCTOR_MODEL);
  const [patientModel, setPatientModel] = useState<ModelId>(DEFAULT_PATIENT_MODEL);
  const [zip, setZip] = useState<ZipState | null>(null);
  const [over, setOver] = useState(false);
  const [cases, setCases] = useState<CaseId[]>([...CASES]);
  const [repByCase, setRepByCase] = useState<Record<CaseId, number>>({ C01: 1, C03: 1, C10: 1 });
  const [mode, setMode] = useState<"replay" | "api">("replay");
  const [callLimit, setCallLimit] = useState(CALL_LIMIT_DEFAULT);
  const [busy, setBusy] = useState("");
  const [preflight, setPreflight] = useState("");
  const [runId, setRunId] = useState("");
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  function persistRun(id: string) {
    try {
      if (id) localStorage.setItem(RUN_STORAGE_KEY, id);
      else localStorage.removeItem(RUN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    const next = searchWithRunId(window.location.search, id);
    window.history.replaceState(null, "", `${window.location.pathname}${next}${window.location.hash}`);
  }

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RUN_STORAGE_KEY);
      const id = restoreRunId(window.location.search, stored);
      if (id) {
        setRunId(id);
        setStatus("queued");
        persistRun(id);
      }
    } catch {
      /* ignore */
    }
    try {
      const raw = sessionStorage.getItem(KEY_SESSION);
      if (!raw) return;
      const d = JSON.parse(raw) as { apiKey?: string; doctorKey?: string; doctorModel?: string; patientModel?: string };
      const loaded = d.apiKey || d.doctorKey || "";
      setApiKey(loaded);
      setMode(loaded.trim() ? "api" : "replay");
      setDoctorModel(asModelId(d.doctorModel, DEFAULT_DOCTOR_MODEL));
      setPatientModel(asModelId(d.patientModel, DEFAULT_PATIENT_MODEL));
      setRemember(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!remember) {
      sessionStorage.removeItem(KEY_SESSION);
      return;
    }
    sessionStorage.setItem(
      KEY_SESSION,
      JSON.stringify({ apiKey, doctorModel, patientModel }),
    );
  }, [remember, apiKey, doctorModel, patientModel]);

  const runCount = cases.reduce((sum, c) => sum + clampRep(repByCase[c] || 1), 0);
  const repsByCase = useMemo(() => {
    const out: Partial<Record<CaseId, number>> = {};
    for (const c of cases) out[c] = clampRep(repByCase[c] || 1);
    return out;
  }, [cases, repByCase]);
  const estimated = useMemo(
    () => estimateCalls(mode, runCount, callLimit),
    [mode, runCount, callLimit],
  );
  const maxTurn = Math.max(1, runCount * 50);
  const pct = Math.min(100, Math.round(((progress.at(-1)?.turn || 0) / maxTurn) * 100));
  let openCase = "";
  for (const event of progress) {
    if (event.kind === "case_start") openCase = event.case || "";
    if (event.kind === "case_end") openCase = "";
  }

  async function onFile(file: File) {
    setError("");
    setBusy("올리는 중…");
    try {
      const result = await upload(`uploads/${file.name}`, file, {
        access: "private",
        handleUploadUrl: "/api/blob/upload",
      });
      const pathname = "pathname" in result ? String(result.pathname) : "";
      const val = await fetch("/api/zip/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathname }),
      }).then((r) => r.json());
      setZip({ pathname, name: file.name, ok: Boolean(val.ok), issues: val.issues || [] });
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy("");
    }
  }

  async function checkConn() {
    setPreflight("");
    setBusy("연결 점검…");
    const res = await fetch("/api/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        doctorModel,
        patientModel,
      }),
    });
    const data = await res.json();
    setBusy("");
    if (!data.ok) {
      setPreflight((data.results || []).map((r: { role: string; error?: string }) => `${r.role}: ${r.error}`).join(" / ") || "실패");
      return;
    }
    setPreflight(data.mode === "replay" ? "키 없음 · 재연 모드로 점검 생략" : "연결 확인");
  }

  async function start() {
    if (!zip?.ok) return;
    setError("");
    setBusy("실행 시작…");
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zipPath: zip.pathname,
        candidate: zip.name.replace(/\.zip$/i, ""),
        cases,
        repsByCase,
        mode: apiKey.trim() ? "api" : "replay",
        apiKey,
        doctorModel,
        patientModel,
        callLimit,
      }),
    });
    const data = await res.json();
    setBusy("");
    if (!res.ok) {
      setError(data.error || "실행 실패");
      return;
    }
    setRunId(data.id);
    setStatus(data.meta?.status || "queued");
    setProgress([]);
    persistRun(data.id);
  }

  const live = shouldKeepPumping(status) || (Boolean(runId) && status === "");

  useEffect(() => {
    if (!runId || !live) return;
    let stop = false;
    async function tick() {
      const res = await fetch(`/api/runs/${runId}`);
      const data = await res.json();
      if (stop) return;
      setProgress(data.progress || []);
      setStatus(data.meta?.status || "");
      if (data.meta?.status === "done") {
        window.location.href = `/runs/${runId}`;
        return;
      }
      if (data.meta?.status === "error" || data.meta?.status === "stopped") {
        setError(data.meta.error || data.error || data.meta.status);
        return;
      }
      setTimeout(tick, 1200);
    }
    tick();
    return () => {
      stop = true;
    };
  }, [runId, live]);

  function toggleCase(c: CaseId) {
    setCases((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <Nav />
          <h1>실행</h1>
        </div>
      </header>
      <Disclaimer />
      <BlobUsagePanel />
      {busy ? <p className="hint">{busy}</p> : null}
      {error ? <p className="bad">{error}</p> : null}
      {(status === "error" || status === "stopped") && runId ? (
        <p>
          <a href={`/runs/${runId}`}>저장된 기록 보기</a>
        </p>
      ) : null}

      <div className="work">
        <div>
          <section className="card">
            <h2>실행 설정</h2>
            <div className="case-head">
              <span>증례</span>
              <span>횟수</span>
            </div>
            <ul className="case-list">
              {CASES.map((c) => (
                <li key={c}>
                  <label className="check">
                    <input type="checkbox" checked={cases.includes(c)} onChange={() => toggleCase(c)} />
                    {c}
                  </label>
                  <input
                    aria-label={`${c} 횟수`}
                    type="number"
                    min={1}
                    max={5}
                    value={repByCase[c]}
                    disabled={!cases.includes(c)}
                    onChange={(e) =>
                      setRepByCase((prev) => ({ ...prev, [c]: clampRep(Number(e.target.value) || 1) }))
                    }
                  />
                </li>
              ))}
            </ul>
            <label htmlFor="run-mode">모드</label>
            <select id="run-mode" value={mode} disabled>
              <option value="replay">재연 (키 없이, 무료)</option>
              <option value="api">실제 모델 (OpenAI)</option>
            </select>
            <p className="hint">
              {mode === "api"
                ? "실제 모델입니다. 공식 샘플은 증례당 약 150–190초입니다. 수십 초면 재연입니다."
                : "재연입니다. 키를 넣으면 실제 모델로 바뀝니다."}
            </p>
            <label htmlFor="call-limit">실행당 호출 수 상한</label>
            <input
              id="call-limit"
              type="number"
              min={1}
              max={200}
              value={callLimit}
              onChange={(e) => setCallLimit(Number(e.target.value) || 200)}
            />
            <p className="hint">
              선택 {cases.length}개 · 합계 {runCount}회 · 예상 호출 {estimated}. 동시 실행은 최대 {MAX_CONCURRENT_RUNS}개입니다.
            </p>
            <button type="button" onClick={start} disabled={!zip?.ok || !cases.length || Boolean(busy) || shouldKeepPumping(status)}>
              실행
            </button>
          </section>
        </div>

        <div className="progress-col">
          <section className="card">
            <h2>진행</h2>
            {runId ? (
              <>
                <div className="progress">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <p className="hint">
                  {status === "queued" ? "대기(서버에서 시작)" : status} · {mode === "api" ? "실제 모델" : "재연"}
                  {openCase ? ` · ${openCase} 진행 중` : ""} · 턴 {progress.at(-1)?.turn || 0} / 약 {maxTurn}
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={async () => {
                    await fetch(`/api/runs/${runId}/stop`, { method: "POST" });
                  }}
                  disabled={!shouldKeepPumping(status)}
                >
                  중지
                </button>
                <div className="turns">
                  {progress.map((p, i) =>
                    p.kind === "case_start" ? (
                      <p key={i} className="case-mark">
                        {p.case} 시작
                      </p>
                    ) : p.kind === "case_end" ? (
                      <p key={i} className={p.ok === false ? "case-mark bad" : "case-mark end"}>
                        {p.case} 끝{p.ok === false ? " · 대화록 없음" : ""}
                      </p>
                    ) : (
                      <p key={i}>
                        [{p.kind} {p.turn}] 의사: {p.doctor}
                        <br />
                        환자: {p.patient}
                      </p>
                    ),
                  )}
                </div>
              </>
            ) : (
              <p className="hint">실행하면 증례 시작·끝과 대화가 여기에 쌓입니다.</p>
            )}
          </section>
        </div>

        <div className="side-col">
          <section className="card">
            <h2>제출 ZIP</h2>
            <p className="hint">공개 샘플·합성 증례만. 비공개 증례·채점 정보·비공개 대화록을 올리지 마세요.</p>
            <div
              className={`drop ${over ? "over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                const f = e.dataTransfer.files[0];
                if (f) onFile(f);
              }}
            >
              <p>끌어놓거나 파일을 고르세요</p>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
            </div>
            {zip ? (
              <p>
                {zip.name} {zip.ok ? <span className="ok">검증 통과</span> : <span className="bad">검증 실패</span>}
              </p>
            ) : null}
            {zip?.issues.length ? (
              <ul>
                {zip.issues.map((i, n) => (
                  <li key={n} className={i.level === "ERROR" ? "bad" : ""}>
                    {i.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <section className="card">
            <h2>OpenAI 키</h2>
            <p className="hint">본인 키만. 대회 개발 키는 넣지 마세요. 서버에 저장하지 않습니다.</p>
            <label htmlFor="api-key">OpenAI 키</label>
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => {
                const v = e.target.value;
                setApiKey(v);
                setMode(v.trim() ? "api" : "replay");
              }}
              placeholder="sk-… (비우면 재연)"
            />
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              이 탭에서만 기억
            </label>
            <div className="row">
              <div>
                <label htmlFor="doctor-model">닥터 모델</label>
                <select
                  id="doctor-model"
                  value={doctorModel}
                  onChange={(e) => setDoctorModel(asModelId(e.target.value, DEFAULT_DOCTOR_MODEL))}
                >
                  {MODELS.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="patient-model">환자 모델</label>
                <select
                  id="patient-model"
                  value={patientModel}
                  onChange={(e) => setPatientModel(asModelId(e.target.value, DEFAULT_PATIENT_MODEL))}
                >
                  {MODELS.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button type="button" className="secondary" onClick={checkConn} disabled={Boolean(busy)}>
              연결 점검
            </button>
            {preflight ? <p className={preflight.includes("실패") || preflight.includes("HTTP") ? "bad" : "ok"}>{preflight}</p> : null}
          </section>
        </div>
      </div>
    </main>
  );
}
