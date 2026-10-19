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

export function searchWithRunId(search: string, id: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (id && isRunId(id)) params.set(RUN_QUERY, id);
  else params.delete(RUN_QUERY);
  const s = params.toString();
  return s ? `?${s}` : "";
}
