import { mergeBlobOps, snapshotBlobOps, type BlobOpSnapshot } from "./blob-ops.ts";
import { readPersistedBlobOps } from "./blob.ts";

const TEAM_ID = "team_U7AuO5lMD3rtoAwkrj410jpx";
const PROJECT_ID = "prj_978x5cNFPaM77I3B78abKhSw3aQT";
const STORE_ID = "store_oAEZw8dMCCbKM7q8";

export type ChargeRow = {
  ServiceName?: string;
  serviceName?: string;
  ConsumedQuantity?: number;
  consumedQuantity?: number;
  ConsumedUnit?: string;
  consumedUnit?: string;
  EffectiveCost?: number;
  effectiveCost?: number;
  Tags?: { ProjectId?: string; ProjectName?: string };
  tags?: { ProjectId?: string; ProjectName?: string };
};

export type BlobChargeSummary = {
  advanced: number;
  simple: number;
  storageGb: number;
  transferGb: number;
  advancedCost: number;
  simpleCost: number;
};

export type BlobUsageReport = {
  fetchedAt: string;
  store: {
    name: string;
    status: string;
    billingState: string;
    usageQuotaExceeded: boolean;
    sizeBytes: number;
    fileCount: number;
  } | null;
  billing: BlobChargeSummary | null;
  instance: BlobOpSnapshot;
  source: string;
  note: string;
  oidc: boolean;
  error?: string;
};

let cache: { at: number; report: BlobUsageReport } | null = null;
const CACHE_MS = 60_000;

function serviceName(row: ChargeRow): string {
  return String(row.ServiceName || row.serviceName || "");
}

function quantity(row: ChargeRow): number {
  const n = Number(row.ConsumedQuantity ?? row.consumedQuantity ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function cost(row: ChargeRow): number {
  const n = Number(row.EffectiveCost ?? row.effectiveCost ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function tags(row: ChargeRow): { ProjectId?: string } {
  return row.Tags || row.tags || {};
}

export function parseChargeRecords(raw: string): ChargeRow[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as { records?: ChargeRow[]; sampleRecords?: ChargeRow[] } | ChargeRow[];
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.records)) return parsed.records;
      if (Array.isArray(parsed.sampleRecords)) return parsed.sampleRecords;
    } catch {
      /* JSONL fallback */
    }
  }
  const rows: ChargeRow[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t) as ChargeRow);
    } catch {
      /* skip */
    }
  }
  return rows;
}

export function summarizeBlobCharges(rows: ChargeRow[], projectId: string): BlobChargeSummary {
  const out: BlobChargeSummary = {
    advanced: 0,
    simple: 0,
    storageGb: 0,
    transferGb: 0,
    advancedCost: 0,
    simpleCost: 0,
  };
  for (const row of rows) {
    const project = tags(row).ProjectId;
    if (project && project !== projectId) continue;
    const name = serviceName(row);
    const qty = quantity(row);
    if (name === "Blob Advanced Operations") {
      out.advanced += qty;
      out.advancedCost += cost(row);
    } else if (name === "Blob Simple Operations") {
      out.simple += qty;
      out.simpleCost += cost(row);
    } else if (name === "Blob Storage Size") {
      out.storageGb += qty;
    } else if (name === "Blob Data Transfer") {
      out.transferGb += qty;
    }
  }
  return out;
}

function monthRangeUtc(now = new Date()): { from: string; to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

async function vercelGet(path: string, token: string, teamId: string): Promise<{ ok: boolean; status: number; text: string }> {
  const url = new URL(`https://api.vercel.com${path}`);
  url.searchParams.set("teamId", teamId);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

export async function loadBlobUsage(now = new Date()): Promise<BlobUsageReport> {
  if (cache && now.getTime() - cache.at < CACHE_MS) return cache.report;
  const teamId = process.env.VERCEL_ORG_ID || TEAM_ID;
  const projectId = process.env.VERCEL_PROJECT_ID || PROJECT_ID;
  const storeId = process.env.BLOB_STORE_ID || STORE_ID;
  const token = process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN || "";
  const persisted = await readPersistedBlobOps();
  const instance = mergeBlobOps(persisted.totals, snapshotBlobOps());
  const note =
    "이 패널은 Blob list를 추가로 치지 않습니다. 진행 조회는 기존처럼 1.2초마다 list·업로드를 씁니다. Pro는 종량 과금이고, Hobby로 내리면 Advanced 2,000회에서 정지됩니다.";
  const suspendedStore: BlobUsageReport["store"] = persisted.suspended
    ? {
        name: "nova-web-runner-blob",
        status: "suspended",
        billingState: "suspended",
        usageQuotaExceeded: true,
        sizeBytes: 0,
        fileCount: 0,
      }
    : null;

  if (!token) {
    const report: BlobUsageReport = {
      fetchedAt: now.toISOString(),
      store: suspendedStore,
      billing: null,
      instance,
      source: "app-counter",
      note,
      oidc: false,
    };
    cache = { at: now.getTime(), report };
    return report;
  }

  const errors: string[] = [];
  let store: BlobUsageReport["store"] = null;
  let billing: BlobChargeSummary | null = null;

  try {
    const st = await vercelGet(`/v1/storage/stores/${storeId}`, token, teamId);
    if (st.ok) {
      const parsed = JSON.parse(st.text) as {
        store?: {
          name?: string;
          status?: string;
          billingState?: string;
          usageQuotaExceeded?: boolean;
          size?: number;
          count?: number;
        };
        name?: string;
        status?: string;
        billingState?: string;
        usageQuotaExceeded?: boolean;
        size?: number;
        count?: number;
      };
      const s = parsed.store || parsed;
      store = {
        name: String(s.name || "blob"),
        status: String(s.status || ""),
        billingState: String(s.billingState || ""),
        usageQuotaExceeded: Boolean(s.usageQuotaExceeded),
        sizeBytes: Number(s.size || 0),
        fileCount: Number(s.count || 0),
      };
    } else {
      errors.push(`스토어 ${st.status}`);
    }
  } catch {
    errors.push("스토어 조회 실패");
  }

  try {
    const { from, to } = monthRangeUtc(now);
    const path = `/v1/billing/charges?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const ch = await vercelGet(path, token, teamId);
    if (ch.ok) {
      billing = summarizeBlobCharges(parseChargeRecords(ch.text), projectId);
    } else {
      errors.push(`과금 ${ch.status}`);
    }
  } catch {
    errors.push("과금 조회 실패");
  }

  const report: BlobUsageReport = {
    fetchedAt: now.toISOString(),
    store: store || suspendedStore,
    billing,
    instance,
    source: store || billing ? "vercel" : "app-counter",
    note,
    oidc: true,
    ...(errors.length ? { error: errors.join(" · ") } : {}),
  };
  cache = { at: now.getTime(), report };
  return report;
}
