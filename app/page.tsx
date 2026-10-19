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
  estimateCalls,
} from "../lib/constants";
import type { CaseId, ModelId } from "../lib/constants";
import type { ProgressEvent } from "../lib/types";

type ZipState = { pathname: string; name: string; ok: boolean; issues: { level: string; message: string }[] };

export default function RunPage() {
  const [apiKey, setApiKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [doctorModel, setDoctorModel] = useState<ModelId>(DEFAULT_DOCTOR_MODEL);
  const [patientModel, setPatientModel] = useState<ModelId>(DEFAULT_PATIENT_MODEL);
  const [zip, setZip] = useState<ZipState | null>(null);
  const [over, setOver] = useState(false);
  const [cases, setCases] = useState<CaseId[]>([...CASES]);
  const [reps, setReps] = useState(1);
  const [mode, setMode] = useState<"replay" | "api">("replay");
  const [callLimit, setCallLimit] = useState(CALL_LIMIT_DEFAULT);
  const [busy, setBusy] = useState("");
  const [preflight, setPreflight] = useState("");
  const [runId, setRunId] = useState("");
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
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

  const estimated = useMemo(
    () => estimateCalls(mode, cases.length, reps, callLimit),
    [mode, cases.length, reps, callLimit],
  );
  const maxTurn = Math.max(1, cases.length * reps * 50);
  const pct = Math.min(100, Math.round(((progress.at(-1)?.turn || 0) / maxTurn) * 100));

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
        reps,
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
    setStatus("running");
    setProgress([]);
  }

  useEffect(() => {
    if (!runId || (status !== "running" && status !== "")) return;
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
  }, [runId, status]);

  function toggleCase(c: CaseId) {
    setCases((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  return (
    <main>
      <Nav />
      <h1>실행</h1>
      <Disclaimer />
      <BlobUsagePanel />

      <section className="card">
        <h2>OpenAI 키</h2>
        <p className="hint">본인 OpenAI 키만 쓰세요. 대회 개발 키는 넣지 마세요. 호출 주소는 api.openai.com으로 고정입니다. 키는 서버에 저장하지 않습니다. 키를 넣으면 실제 모델, 비우면 재연입니다.</p>
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
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => {
              setRemember(e.target.checked);
            }}
          />
          이 탭에서만 기억 (sessionStorage). localStorage에는 두지 않습니다.
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
        <p className="hint">기본은 닥터·환자 모두 gpt-6-luna(로컬 실행기·샘플 검증 참고). 환자 gpt-6.1-sol은 공식 평가처럼 근사할 때만. 공식 환자 모델은 공개되지 않았습니다.</p>
        <p>
          <button type="button" className="secondary" onClick={checkConn} disabled={Boolean(busy)}>
            연결 점검
          </button>
        </p>
        {preflight ? <p className={preflight.includes("실패") || preflight.includes("HTTP") ? "bad" : "ok"}>{preflight}</p> : null}
      </section>

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
          <div>
            <p>
              {zip.name} {zip.ok ? <span className="ok">검증 통과</span> : <span className="bad">검증 실패</span>}
            </p>
            <ul>
              {zip.issues.map((i, n) => (
                <li key={n} className={i.level === "ERROR" ? "bad" : ""}>
                  {i.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>실행 설정</h2>
        <p>증례</p>
        {CASES.map((c) => (
          <label key={c} className="check">
            <input type="checkbox" checked={cases.includes(c)} onChange={() => toggleCase(c)} />
            {c}
          </label>
        ))}
        <label>반복 횟수</label>
        <input type="number" min={1} max={5} value={reps} onChange={(e) => setReps(Number(e.target.value) || 1)} />
        <label htmlFor="run-mode">모드</label>
        <select id="run-mode" value={mode} disabled>
          <option value="replay">재연 (키 없이, 무료)</option>
          <option value="api">실제 모델 (OpenAI)</option>
        </select>
        <p className="hint">
          {mode === "api"
            ? "실제 모델입니다. 공식 샘플 검증은 증례당 약 150–190초, 리더보드는 약 200–230초입니다. 수십 초면 재연입니다. 진찰은 항상 bank입니다."
            : "재연입니다. 키를 넣으면 실제 모델로 바뀝니다."}
        </p>
        <label>실행당 호출 수 상한</label>
        <input type="number" min={1} max={200} value={callLimit} onChange={(e) => setCallLimit(Number(e.target.value) || 200)} />
        <p className="hint">예상 호출 수: {estimated} (재연은 0). 실제 모델은 키 소유자가 비용을 부담합니다. 동시 실행은 최대 {MAX_CONCURRENT_RUNS}개입니다. 4번째부터는 거절됩니다.</p>
        <button type="button" onClick={start} disabled={!zip?.ok || !cases.length || Boolean(busy) || status === "running"}>
          실행
        </button>
      </section>

      {busy ? <p>{busy}</p> : null}
      {error ? <p className="bad">{error}</p> : null}

      {runId ? (
        <section className="card">
          <h2>진행</h2>
          <div className="progress">
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="hint">
            {status} · {mode === "api" ? "실제 모델" : "재연"} · 턴 {progress.at(-1)?.turn || 0} / 약 {maxTurn}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await fetch(`/api/runs/${runId}/stop`, { method: "POST" });
            }}
            disabled={status !== "running"}
          >
            중지
          </button>
          <div className="turns">
            {progress.map((p, i) => (
              <p key={i}>
                [{p.kind} {p.turn}] 의사: {p.doctor}
                <br />
                환자: {p.patient}
              </p>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
