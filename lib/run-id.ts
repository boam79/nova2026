export const RUN_QUERY = "run";
export const RUN_STORAGE_KEY = "nova_web_run";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRunId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function parseRunIdFromSearch(search: string): string {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const id = new URLSearchParams(q).get(RUN_QUERY) || "";
  return isRunId(id) ? id : "";
}

export function restoreRunId(search: string, stored: string | null | undefined): string {
  const fromQuery = parseRunIdFromSearch(search);
  if (fromQuery) return fromQuery;
  const fromStore = (stored || "").trim();
  return isRunId(fromStore) ? fromStore : "";
}

/** 로그인·새로고침 뒤에는 아직 도는 실행만 다시 붙인다. 끝난 결과로 보내지 않는다. */
export function shouldResumeSavedRun(status: string | undefined): boolean {
  return status === "queued" || status === "running";
}

/** 끝난·없는 실행 id는 저장에서 지운다. 조회 실패(401/5xx) 때는 지우지 않는다. */
export function shouldClearSavedRun(httpStatus: number, runStatus: string | undefined): boolean {
  if (httpStatus === 404) return true;
  if (httpStatus >= 200 && httpStatus < 300 && !shouldResumeSavedRun(runStatus)) return true;
  return false;
}

export function searchWithRunId(search: string, id: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (id && isRunId(id)) params.set(RUN_QUERY, id);
  else params.delete(RUN_QUERY);
  const s = params.toString();
  return s ? `?${s}` : "";
}
