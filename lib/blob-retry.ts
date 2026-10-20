export function isTransientBlobError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /Failed to fetch blob: 5\d\d|\b502\b|\b503\b|ECONNRESET|ETIMEDOUT|UND_ERR/.test(msg);
}

export async function retryBlob<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransientBlobError(err) || i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 150 * (i + 1)));
    }
  }
  throw last;
}
