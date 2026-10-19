const KEY_RE = /(?<![A-Za-z0-9])sk-[A-Za-z0-9_\-]{8,}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9_\-\.]+/gi;

export function maskText(text: string, secrets: string[] = []): string {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (secret && secret.length >= 8) {
      out = out.split(secret).join("***");
    }
  }
  return out.replace(KEY_RE, "sk-***").replace(BEARER_RE, "Bearer ***");
}

export function looksLikeKey(value: string): boolean {
  return /(?<![A-Za-z0-9])sk-[A-Za-z0-9_\-]{8,}/.test(value);
}

export function assertNoSecrets(payload: unknown, secrets: string[] = []): void {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const masked = maskText(text, secrets);
  if (masked !== text) {
    throw new Error("secret_leak");
  }
  for (const secret of secrets) {
    if (secret && secret.length >= 8 && text.includes(secret)) {
      throw new Error("secret_leak");
    }
  }
}

export function scrubValue<T>(value: T, secrets: string[] = []): T {
  if (typeof value === "string") {
    return maskText(value, secrets) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, secrets)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/key|token|secret|authorization/i.test(k)) continue;
      out[k] = scrubValue(v, secrets);
    }
    return out as T;
  }
  return value;
}
