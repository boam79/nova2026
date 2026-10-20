import assert from "node:assert/strict";
import { test } from "node:test";
import { isTransientBlobError, retryBlob } from "../lib/blob-retry.ts";

test("blob 5xx is retried, other errors are not", () => {
  assert.equal(isTransientBlobError(new Error("Vercel Blob: Failed to fetch blob: 500 Internal Server Error")), true);
  assert.equal(isTransientBlobError(new Error("없음")), false);
});

test("retryBlob succeeds after a transient failure", async () => {
  let n = 0;
  const value = await retryBlob(async () => {
    n += 1;
    if (n < 2) throw new Error("Vercel Blob: Failed to fetch blob: 500 Internal Server Error");
    return "ok";
  });
  assert.equal(value, "ok");
  assert.equal(n, 2);
});
