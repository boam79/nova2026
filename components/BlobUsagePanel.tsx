"use client";

import { useCallback, useEffect, useState } from "react";
import type { BlobUsageReport } from "../lib/blob-usage";

const REFRESH_MS = 60_000;

function fmt(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("ko-KR");
}

function fmtMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
  const billed = data?.billing;
  const inst = data?.instance;
  const ok = store && store.billingState === "active" && !store.usageQuotaExceeded;

  return (
    <section className="card" aria-labelledby="blob-usage-heading">
      <h2 id="blob-usage-heading">Blob 횟수</h2>
      <p className={ok ? "ok" : store?.billingState === "suspended" ? "bad" : "hint"}>
        스토어: {storeLabel(store ?? null)}
        {store ? ` · ${fmtMb(store.sizeBytes)} · 파일 ${fmt(store.fileCount)}개` : ""}
      </p>
      <div className="metrics">
        <p>
          <strong>Advanced (list·업로드)</strong>
          <br />
          과금 {fmt(billed?.advanced)}회 · 이 앱 {fmt(inst?.advanced)}회
          <br />
          <span className="hint">list {fmt(inst?.list)} · 업로드 {fmt(inst?.put)}</span>
        </p>
        <p>
          <strong>Simple (읽기 등)</strong>
          <br />
          과금 {fmt(billed?.simple)}회 · 이 앱 {fmt(inst?.simple)}회
        </p>
      </div>
      <p className="hint">{data?.note || "진행 폴링과는 따로, 최대 1분마다 갱신합니다. Blob list를 집계용으로 치지 않습니다."}</p>
      {error ? <p className="hint">{error}</p> : null}
      <p>
        <button type="button" className="secondary" onClick={load} disabled={busy}>
          {busy ? "읽는 중…" : "새로고침"}
        </button>
        {data?.fetchedAt ? (
          <span className="hint"> {new Date(data.fetchedAt).toLocaleString("ko-KR")}</span>
        ) : null}
      </p>
    </section>
  );
}
