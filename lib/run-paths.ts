export function kstDate(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** id만 있을 때 최근 날짜부터 meta.json 경로를 찍는다. 전체 list는 최후 수단. */
export function guessMetaPaths(id: string, now = new Date()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const delta of [0, -1, 1, -2]) {
    const t = new Date(now.getTime() + delta * 86_400_000);
    const pathname = `runs/${kstDate(t)}/${id}/meta.json`;
    if (seen.has(pathname)) continue;
    seen.add(pathname);
    out.push(pathname);
  }
  return out;
}
