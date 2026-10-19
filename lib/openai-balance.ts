import { BLOCKED_HOST, OPENAI_BASE } from "./constants.ts";
import { assertNoSecrets, maskText } from "./mask.ts";

export type OpenAIBalanceSource = "credit_grants" | "costs" | "none";

export type OpenAIBalanceReport = {
  fetchedAt: string;
  available: number | null;
  granted: number | null;
  used: number | null;
  monthSpend: number | null;
  source: OpenAIBalanceSource;
  error?: string;
};

export function monthStartUnix(now = new Date()): number {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function balanceHttpHint(status: number): string {
  const hint: Record<number, string> = {
    401: "키가 틀렸거나 만료됨",
    403: "이 키로는 잔액을 읽을 수 없습니다",
    404: "잔액 API를 찾을 수 없습니다",
    429: "사용 한도·요금 확인",
  };
  return `HTTP ${status} (${hint[status] || "주소·네트워크 확인"})`;
}

export function parseCreditGrants(raw: unknown): { granted: number; used: number; available: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const granted = Number(o.total_granted);
  const used = Number(o.total_used);
  const available = Number(o.total_available);
  if (![granted, used, available].every(Number.isFinite)) return null;
  return { granted, used, available };
}

export function sumCostBuckets(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const data = (raw as { data?: unknown }).data;
  if (!Array.isArray(data)) return 0;
  let sum = 0;
  for (const bucket of data) {
    if (!bucket || typeof bucket !== "object") continue;
    const results = (bucket as { results?: unknown }).results;
    if (!Array.isArray(results)) continue;
    for (const row of results) {
      if (!row || typeof row !== "object") continue;
      const amount = (row as { amount?: { value?: unknown } }).amount;
      const value = Number(amount?.value);
      if (Number.isFinite(value)) sum += value;
    }
  }
  return sum;
}

async function openaiGet(path: string, key: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${OPENAI_BASE}${path.startsWith("/") ? path : `/${path}`}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

export async function fetchOpenAIBalance(key: string, now = new Date()): Promise<OpenAIBalanceReport> {
  const fetchedAt = now.toISOString();
  const empty: OpenAIBalanceReport = {
    fetchedAt,
    available: null,
    granted: null,
    used: null,
    monthSpend: null,
    source: "none",
  };
  const trimmed = key.trim();
  if (!trimmed) return empty;
  if (BLOCKED_HOST.test(OPENAI_BASE)) {
    return { ...empty, error: "대회 주소는 쓸 수 없습니다." };
  }

  let grantsStatus = 0;
  try {
    const grants = await openaiGet("/dashboard/billing/credit_grants", trimmed);
    grantsStatus = grants.status;
    if (grants.status === 200) {
      const parsed = parseCreditGrants(grants.json);
      if (parsed) {
        const report: OpenAIBalanceReport = {
          fetchedAt,
          available: parsed.available,
          granted: parsed.granted,
          used: parsed.used,
          monthSpend: null,
          source: "credit_grants",
        };
        assertNoSecrets(report, [trimmed]);
        return report;
      }
    }
  } catch (err) {
    empty.error = maskText(String((err as Error).message || err), [trimmed]);
  }

  try {
    const costs = await openaiGet(
      `/organization/costs?start_time=${monthStartUnix(now)}&bucket_width=1d&limit=31`,
      trimmed,
    );
    if (costs.status === 200) {
      const report: OpenAIBalanceReport = {
        fetchedAt,
        available: null,
        granted: null,
        used: null,
        monthSpend: sumCostBuckets(costs.json),
        source: "costs",
      };
      assertNoSecrets(report, [trimmed]);
      return report;
    }
    const status = grantsStatus || costs.status;
    return { ...empty, error: maskText(balanceHttpHint(status), [trimmed]) };
  } catch (err) {
    return {
      ...empty,
      error: empty.error || maskText(String((err as Error).message || err), [trimmed]),
    };
  }
}
