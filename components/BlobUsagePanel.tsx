"use client";

import { useCallback, useEffect, useState } from "react";
import type { BlobUsageReport } from "../lib/blob-usage";

const REFRESH_MS = 60_000;

function fmt(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("ko-KR");
}

function storeLabel(store: BlobUsageReport["store"] | undefined): string {
  if (!store) return "조회 안 됨";
  if (store.billingState === "suspended" || store.status.includes("suspended")) return "정지";
  if (store.usageQuotaExceeded) return "한도 초과";
  if (store.billingState === "active" || store.status === "available") return "사용 가능";
  return store.billingState || store.status || "알 수 없음";
}

export function BlobUsagePanel() {
  const [data, setData] = useState<BlobUsageReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/blob-usage", { cache: "no-store" });
      const json = (await res.json()) as BlobUsageReport;
      if (!res.ok) {
        setError("사용량을 읽지 못했습니다.");
        return;
      }
      setData(json);
      setError(json.error || "");
    } catch {
      setError("사용량을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const store = data?.store;
  const inst = data?.instance;
  const label = storeLabel(store ?? null);

  return (
    <section className="blob-bar" aria-label="Blob 횟수">
      <strong>Blob 조회</strong>
      <span>스토어 {label}</span>
      <span>
        Advanced {fmt(inst?.advanced)}회
        <span className="hint">list {fmt(inst?.list)} · 업로드 {fmt(inst?.put)}</span>
      </span>
      <span>Simple {fmt(inst?.simple)}회</span>
      <button type="button" className="secondary" onClick={load} disabled={busy}>
        {busy ? "읽는 중…" : "새로고침"}
      </button>
      {error ? <span className="bad">{error}</span> : null}
    </section>
  );
}
