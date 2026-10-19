import assert from "node:assert/strict";
import { test } from "node:test";
import { admitRun, parseLock, releaseRun } from "../lib/run-lock.ts";

const t0 = new Date("2026-10-18T12:00:00.000Z");

test("admits three then rejects the fourth", () => {
  let state = parseLock(null);
  const a = admitRun(state, "a", t0, 3);
  assert.equal(a.ok, true);
  const b = admitRun(a.state, "b", t0, 3);
  assert.equal(b.ok, true);
  const c = admitRun(b.state, "c", t0, 3);
  assert.equal(c.ok, true);
  assert.equal(c.state.runs.length, 3);
  const d = admitRun(c.state, "d", t0, 3);
  assert.equal(d.ok, false);
  assert.equal(d.state.runs.map((r) => r.id).join(","), "a,b,c");
});

test("legacy single lock counts as one in-flight run", () => {
  const state = parseLock({ id: "old", at: t0.toISOString() });
  assert.equal(state.runs.length, 1);
  const next = admitRun(state, "new", t0, 3);
  assert.equal(next.ok, true);
  assert.equal(next.state.runs.length, 2);
});

test("expired slot is freed so a new run can start", () => {
  const old = new Date(t0.getTime() - 46 * 60 * 1000);
  const state = parseLock({
    runs: [
      { id: "stale", at: old.toISOString() },
      { id: "live", at: t0.toISOString() },
    ],
  });
  const next = admitRun(state, "fresh", t0, 3);
  assert.equal(next.ok, true);
  assert.deepEqual(
    next.state.runs.map((r) => r.id).sort(),
    ["fresh", "live"],
  );
});

test("release one id then a fourth can start", () => {
  let state = parseLock(null);
  for (const id of ["a", "b", "c"]) state = admitRun(state, id, t0, 3).state;
  state = releaseRun(state, "b");
  const next = admitRun(state, "d", t0, 3);
  assert.equal(next.ok, true);
  assert.deepEqual(
    next.state.runs.map((r) => r.id).sort(),
    ["a", "c", "d"],
  );
});
