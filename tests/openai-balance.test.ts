import assert from "node:assert/strict";
import { test } from "node:test";
import {
  balanceHttpHint,
  formatUsd,
  monthStartUnix,
  parseCreditGrants,
  sumCostBuckets,
} from "../lib/openai-balance.ts";

test("credit grants expose remaining prepaid balance", () => {
  const parsed = parseCreditGrants({
    object: "credit_summary",
    total_granted: 120,
    total_used: 25.5,
    total_available: 94.5,
  });
  assert.deepEqual(parsed, { granted: 120, used: 25.5, available: 94.5 });
});

test("malformed credit grants are rejected", () => {
  assert.equal(parseCreditGrants(null), null);
  assert.equal(parseCreditGrants({ total_granted: 1 }), null);
  assert.equal(parseCreditGrants({ total_granted: "x", total_used: 1, total_available: 1 }), null);
});

test("cost buckets add billed dollars for the month", () => {
  const spend = sumCostBuckets({
    object: "page",
    data: [
      {
        results: [
          { amount: { value: 1.2, currency: "usd" } },
          { amount: { value: 0.3, currency: "usd" } },
        ],
      },
      { results: [{ amount: { value: 2 } }] },
    ],
  });
  assert.equal(spend, 3.5);
  assert.equal(sumCostBuckets({ data: [] }), 0);
});

test("usd formatter and month start are stable", () => {
  assert.equal(formatUsd(94.5), "$94.50");
  assert.equal(formatUsd(null), "—");
  assert.equal(monthStartUnix(new Date("2026-10-19T22:00:00.000Z")), Date.UTC(2026, 9, 1) / 1000);
});

test("http hints stay korean and never echo a key", () => {
  assert.match(balanceHttpHint(403), /이 키로는 잔액을 읽을 수 없습니다/);
  assert.match(balanceHttpHint(401), /만료/);
  assert.equal(balanceHttpHint(403).includes("sk-"), false);
});
