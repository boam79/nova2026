import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isContinuePath,
  needsPumpKick,
  pumpBudgetLeft,
  shouldChainPump,
  shouldKeepPumping,
  shouldStopOnClientDisconnect,
  startDisconnectAction,
  verifyPumpSecret,
} from "../lib/run-pump.ts";

test("pump keeps going while queued or running", () => {
  assert.equal(shouldKeepPumping("queued"), true);
  assert.equal(shouldKeepPumping("running"), true);
  assert.equal(shouldKeepPumping("done"), false);
  assert.equal(shouldKeepPumping("error"), false);
  assert.equal(shouldKeepPumping("stopped"), false);
});

test("start request abort does not stop or interrupt the run", () => {
  assert.equal(shouldStopOnClientDisconnect(), false);
  assert.equal(startDisconnectAction(), "ignore");
});

test("pump chains only while still active after the budget", () => {
  assert.equal(shouldChainPump("running", 0), true);
  assert.equal(shouldChainPump("queued", -10), true);
  assert.equal(shouldChainPump("running", 1_000), false);
  assert.equal(shouldChainPump("done", 0), false);
  assert.equal(shouldChainPump("stopped", 0), false);
});

test("budget counts down from the start of this function", () => {
  const t0 = Date.parse("2026-10-19T12:00:00.000Z");
  assert.equal(pumpBudgetLeft(t0, t0, 240_000), 240_000);
  assert.equal(pumpBudgetLeft(t0, t0 + 240_000, 240_000), 0);
  assert.ok(pumpBudgetLeft(t0, t0 + 241_000, 240_000) < 0);
});

test("kick a pump when queued/running and last pump is missing or stale", () => {
  const now = Date.parse("2026-10-19T12:00:00.000Z");
  const createdNow = new Date(now).toISOString();
  const createdOld = new Date(now - 20_000).toISOString();
  assert.equal(
    needsPumpKick({ status: "queued", sandboxId: "", createdAt: createdNow, pumpedAt: createdNow }, now),
    false,
  );
  assert.equal(
    needsPumpKick({ status: "queued", sandboxId: "", createdAt: createdOld, pumpedAt: createdOld }, now),
    true,
  );
  assert.equal(
    needsPumpKick({ status: "running", sandboxId: "sb_1", createdAt: createdOld, pumpedAt: undefined }, now),
    true,
  );
  assert.equal(
    needsPumpKick({ status: "running", sandboxId: "sb_1", createdAt: createdOld, pumpedAt: createdNow }, now),
    false,
  );
  assert.equal(
    needsPumpKick(
      { status: "running", sandboxId: "sb_1", createdAt: createdOld, pumpedAt: new Date(now - 30_000).toISOString() },
      now,
    ),
    true,
  );
  assert.equal(
    needsPumpKick({ status: "done", sandboxId: "sb_1", createdAt: createdOld, pumpedAt: createdOld }, now),
    false,
  );
});

test("pump secret must match and empty secret is never accepted", () => {
  assert.equal(verifyPumpSecret("abc", "abc"), true);
  assert.equal(verifyPumpSecret("abc", "xyz"), false);
  assert.equal(verifyPumpSecret("", "abc"), false);
  assert.equal(verifyPumpSecret("abc", ""), false);
  assert.equal(verifyPumpSecret(null, "abc"), false);
});

test("continue path is only the pump endpoint", () => {
  assert.equal(isContinuePath("/api/runs/11111111-1111-1111-1111-111111111111/continue"), true);
  assert.equal(isContinuePath("/api/runs/x/stop"), false);
  assert.equal(isContinuePath("/api/runs/x"), false);
});
