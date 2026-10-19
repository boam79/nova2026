export type BlobOpKind = "list" | "put" | "get" | "del";
export type BlobOpClass = "advanced" | "simple";

export type BlobOpSnapshot = {
  list: number;
  put: number;
  get: number;
  del: number;
  advanced: number;
  simple: number;
};

const counts = { list: 0, put: 0, get: 0, del: 0 };

export function blobOpClass(kind: BlobOpKind): BlobOpClass {
  return kind === "list" || kind === "put" ? "advanced" : "simple";
}

export function recordBlobOp(kind: BlobOpKind): void {
  counts[kind] += 1;
}

export function snapshotBlobOps(): BlobOpSnapshot {
  return {
    list: counts.list,
    put: counts.put,
    get: counts.get,
    del: counts.del,
    advanced: counts.list + counts.put,
    simple: counts.get + counts.del,
  };
}

export function resetBlobOps(): void {
  counts.list = 0;
  counts.put = 0;
  counts.get = 0;
  counts.del = 0;
}

export function resetBlobOpsForTests(): void {
  resetBlobOps();
}

export function takeBlobOpsDelta(): BlobOpSnapshot {
  const snap = snapshotBlobOps();
  resetBlobOps();
  return snap;
}

export function mergeBlobOps(base: BlobOpSnapshot, delta: BlobOpSnapshot): BlobOpSnapshot {
  const list = base.list + delta.list;
  const put = base.put + delta.put;
  const get = base.get + delta.get;
  const del = base.del + delta.del;
  return {
    list,
    put,
    get,
    del,
    advanced: list + put,
    simple: get + del,
  };
}

export const emptyBlobOps: BlobOpSnapshot = {
  list: 0,
  put: 0,
  get: 0,
  del: 0,
  advanced: 0,
  simple: 0,
};

export const BLOB_METRICS_PATH = "metrics/blob-ops.json";
