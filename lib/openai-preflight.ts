import { BLOCKED_HOST, OPENAI_BASE } from "./constants";
import { maskText } from "./mask";

export type PreflightResult = {
  ok: boolean;
  role: "doctor" | "patient";
  model: string;
  error?: string;
};

export async function preflightRole(
  role: "doctor" | "patient",
  key: string,
  model: string,
): Promise<PreflightResult> {
  if (!key) return { ok: true, role, model, error: "offline" };
  if (BLOCKED_HOST.test(OPENAI_BASE)) {
    return { ok: false, role, model, error: "대회 주소는 쓸 수 없습니다." };
  }
  try {
    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "확인용 호출입니다. 네라고만 답하세요." }],
        max_completion_tokens: 16,
      }),
    });
    if (res.ok) return { ok: true, role, model };
    const hint: Record<number, string> = {
      401: "키가 틀렸거나 만료됨",
      403: "권한 없음",
      404: "모델 이름 확인",
      429: "사용 한도·요금 확인",
    };
    const raw = maskText(await res.text());
    return {
      ok: false,
      role,
      model,
      error: `HTTP ${res.status} (${hint[res.status] || "주소·네트워크 확인"})`,
    };
  } catch (err) {
    return { ok: false, role, model, error: maskText(String((err as Error).message || err)) };
  }
}
