"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUsd, type OpenAIBalanceReport } from "../lib/openai-balance";

const REFRESH_MS = 60_000;

export function OpenAIBalancePanel({ apiKey }: { apiKey: string }) {
  const [data, setData] = useState<OpenAIBalanceReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = apiKey.trim();

  const load = useCallback(async () => {
    if (!key) {
      setData(null);
      setError("");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/openai-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ apiKey: key }),
      });
      const json = (await res.json()) as OpenAIBalanceReport;
      if (!res.ok) {
        setError("잔액을 읽지 못했습니다.");
        return;
      }
      setData(json);
      setError(json.error || "");
    } catch {
      setError("잔액을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [key]);

  useEffect(() => {
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!key) return;
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [key, load]);

  const available = data?.available;
  const low = available != null && available <= 5;

  return (
    <section className="blob-bar" aria-label="OpenAI 잔액">
      <strong>OpenAI 잔액</strong>
      {!key ? (
        <span className="hint">진료용 키로는 보통 잔액을 못 읽고, 실행은 됩니다.</span>
      ) : data?.source === "credit_grants" ? (
        <>
          <span className={low ? "bad" : "ok"}>{formatUsd(available)}</span>
          <span>
            지급 {formatUsd(data.granted)}
            <span className="hint">사용 {formatUsd(data.used)}</span>
          </span>
        </>
      ) : data?.source === "costs" ? (
        <>
          <span>이번 달 사용 {formatUsd(data.monthSpend)}</span>
          <span className="hint">남은 크레딧은 이 키로 안 읽혀 사용액만 표시합니다.</span>
        </>
      ) : data?.errorKind === "permission" ? (
        <span className="hint">{error || "진료용 키로는 잔액을 못 읽습니다. 실행은 됩니다."}</span>
      ) : (
        <span className="hint">{busy ? "읽는 중…" : "아직 못 읽었습니다."}</span>
      )}
      <button type="button" className="secondary" onClick={load} disabled={busy || !key}>
        {busy ? "읽는 중…" : "새로고침"}
      </button>
      {error && data?.errorKind !== "permission" ? <span className="bad">{error}</span> : null}
    </section>
  );
}
