import assert from "node:assert/strict";
import { test } from "node:test";
import { blobOpClass, mergeBlobOps, resetBlobOpsForTests, recordBlobOp, snapshotBlobOps } from "../lib/blob-ops.ts";
import { parseChargeRecords, summarizeBlobCharges } from "../lib/blob-usage.ts";

test("list and put are advanced, get is simple", () => {
  assert.equal(blobOpClass("list"), "advanced");
  assert.equal(blobOpClass("put"), "advanced");
  assert.equal(blobOpClass("get"), "simple");
  assert.equal(blobOpClass("del"), "simple");
});

test("in-memory counter tallies ops without listing", () => {
  resetBlobOpsForTests();
  recordBlobOp("list");
  recordBlobOp("list");
  recordBlobOp("put");
  recordBlobOp("get");
  const snap = snapshotBlobOps();
  assert.equal(snap.list, 2);
  assert.equal(snap.put, 1);
  assert.equal(snap.get, 1);
  assert.equal(snap.advanced, 3);
  assert.equal(snap.simple, 1);
});

test("mergeBlobOps adds deltas for persisted totals", () => {
  const merged = mergeBlobOps(
    { list: 10, put: 4, get: 1, del: 0, advanced: 14, simple: 1 },
    { list: 2, put: 1, get: 3, del: 1, advanced: 3, simple: 4 },
  );
  assert.equal(merged.list, 12);
  assert.equal(merged.put, 5);
  assert.equal(merged.advanced, 17);
  assert.equal(merged.simple, 5);
});

test("parseChargeRecords reads JSONL and JSON array", () => {
  const jsonl = [
    '{"ServiceName":"Blob Advanced Operations","ConsumedQuantity":10}',
    '{"ServiceName":"CDN Requests","ConsumedQuantity":3}',
  ].join("\n");
  const rows = parseChargeRecords(jsonl);
  assert.equal(rows.length, 2);
  const wrapped = parseChargeRecords(JSON.stringify({ records: [{ ServiceName: "Blob Simple Operations", ConsumedQuantity: 4 }] }));
  assert.equal(wrapped.length, 1);
});

test("summarizeBlobCharges keeps this project and untagged blob rows", () => {
  const projectId = "prj_nova";
  const s = summarizeBlobCharges(
    [
      { ServiceName: "Blob Advanced Operations", ConsumedQuantity: 100, Tags: { ProjectId: projectId } },
      { ServiceName: "Blob Advanced Operations", ConsumedQuantity: 50, Tags: {} },
      { ServiceName: "Blob Advanced Operations", ConsumedQuantity: 999, Tags: { ProjectId: "other" } },
      { ServiceName: "Blob Simple Operations", ConsumedQuantity: 7, Tags: { ProjectId: projectId } },
      { serviceName: "Blob Storage Size", ConsumedQuantity: 0.004, ConsumedUnit: "gigabyte" },
    ],
    projectId,
  );
  assert.equal(s.advanced, 150);
  assert.equal(s.simple, 7);
  assert.equal(s.storageGb, 0.004);
});
