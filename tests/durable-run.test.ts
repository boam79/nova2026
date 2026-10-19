import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACTIVE_RUN_STORAGE_KEY,
  CONTINUE_HEADER,
  continuePayload,
  isActiveRunStatus,
  planPumpTick,
  PUMP_SLICE_MS,
  queueRunAndContinue,
  resumeRunView,
  shouldResumePoll,
} from "../lib/durable-run.ts";

test("refresh or disconnect does not abort a queued run", async () => {
  const events: string[] = [];
  let background: () => Promise<void> = async () => {};
  const ac = new AbortController();
  const queued = await queueRunAndContinue({
    signal: ac.signal,
    queue: async () => {
      events.push("queue");
      return { id: "run-1", status: "queued" as const };
    },
    scheduleAfter: (work) => {
      events.push("schedule");
      background = work;
    },
    launch: async () => {
      events.push("launch");
      return { id: "run-1", status: "running" as const, sandboxId: "sbx" };
    },
    pump: async () => {
      events.push("pump");
    },
  });
  assert.equal(queued.id, "run-1");
  assert.deepEqual(events, ["queue", "schedule"]);
  ac.abort();
  await background();
  assert.deepEqual(events, ["queue", "schedule", "launch", "pump"]);
});

test("client can resume viewing a run after refresh from url or storage", () => {
  const fromUrl = resumeRunView({ urlRunId: "abc", storedRunId: "old" });
  assert.equal(fromUrl?.runId, "abc");
  assert.equal(fromUrl?.poll, true);
  const fromStore = resumeRunView({ urlRunId: " ", storedRunId: "abc" });
  assert.equal(fromStore?.runId, "abc");
  assert.equal(resumeRunView({ urlRunId: "", storedRunId: "" }), null);
  assert.equal(ACTIVE_RUN_STORAGE_KEY, "nova_active_run");
});

test("resume keeps polling while queued or running", () => {
  assert.equal(shouldResumePoll("queued"), true);
  assert.equal(shouldResumePoll("running"), true);
  assert.equal(shouldResumePoll("done"), false);
  assert.equal(shouldResumePoll("error"), false);
  assert.equal(shouldResumePoll("stopped"), false);
  assert.equal(isActiveRunStatus("queued"), true);
  assert.equal(isActiveRunStatus("done"), false);
});

test("pump keeps going until the run is terminal, then reenqueues when the slice is up", () => {
  assert.equal(planPumpTick({ status: "queued", hasSandbox: false, sliceElapsedMs: 1000 }), "wait");
  assert.equal(planPumpTick({ status: "running", hasSandbox: true, sliceElapsedMs: 1000 }), "poll");
  assert.equal(
    planPumpTick({ status: "running", hasSandbox: true, sliceElapsedMs: PUMP_SLICE_MS }),
    "reenqueue",
  );
  assert.equal(planPumpTick({ status: "done", hasSandbox: true, sliceElapsedMs: 1000 }), "finish");
  assert.equal(planPumpTick({ status: "error", hasSandbox: false, sliceElapsedMs: 1000 }), "finish");
  assert.equal(planPumpTick({ status: "stopped", hasSandbox: true, sliceElapsedMs: 1000 }), "finish");
});

test("continue token payload is bound to the run id", () => {
  assert.equal(continuePayload("run-1"), "continue.run-1");
  assert.equal(CONTINUE_HEADER, "x-nova-continue");
});

test("continue path bypasses the login cookie but stays scoped to one run", async () => {
  const { isContinuePath } = await import("../lib/durable-run.ts");
  assert.equal(isContinuePath("/api/runs/run-1/continue"), true);
  assert.equal(isContinuePath("/api/runs/run-1"), false);
  assert.equal(isContinuePath("/api/runs/run-1/stop"), false);
});

test("continue signature matches only that run id", async () => {
  const { signPayload, verifySignedPayload } = await import("../lib/auth.ts");
  const sig = await signPayload("secret", continuePayload("run-1"));
  assert.equal(await verifySignedPayload("secret", continuePayload("run-1"), sig), true);
  assert.equal(await verifySignedPayload("secret", continuePayload("run-2"), sig), false);
  assert.equal(await verifySignedPayload("secret", continuePayload("run-1"), "nope"), false);
});
