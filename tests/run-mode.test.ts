import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCalls } from "../lib/constants.ts";
import { formatRepsArg, resolveRunMode, runnerLaunchArgs } from "../lib/run-mode.ts";

test("empty key is always replay even if client asked for api", () => {
  assert.equal(resolveRunMode("api", ""), "replay");
  assert.equal(resolveRunMode("replay", "  "), "replay");
});

test("nonempty key is api even if client asked for replay", () => {
  assert.equal(resolveRunMode("replay", "sk-test-not-a-real-key"), "api");
  assert.equal(resolveRunMode("api", "sk-test-not-a-real-key"), "api");
});

test("replay launch is offline and does not pass keys", () => {
  const launch = runnerLaunchArgs({
    cases: ["C01"],
    reps: 1,
    doctorModel: "gpt-6-luna",
    patientModel: "gpt-6-luna",
    mode: "replay",
  });
  assert.equal(launch.offline, true);
  assert.equal(launch.passKeys, false);
  assert.ok(launch.args.includes("--offline"));
});

test("api launch is not offline and passes keys", () => {
  const launch = runnerLaunchArgs({
    cases: ["C01"],
    reps: 1,
    doctorModel: "gpt-6-luna",
    patientModel: "gpt-6.1-sol",
    mode: "api",
  });
  assert.equal(launch.offline, false);
  assert.equal(launch.passKeys, true);
  assert.equal(launch.args.includes("--offline"), false);
  assert.ok(launch.args.includes("gpt-6-luna"));
  assert.ok(launch.args.includes("gpt-6.1-sol"));
});

test("each case can carry its own repeat count", () => {
  assert.equal(formatRepsArg(["C01", "C03", "C10"], { C01: 2, C03: 1, C10: 9 }), "C01=2,C03=1,C10=5");
  const launch = runnerLaunchArgs({
    cases: ["C01", "C10"],
    repsByCase: { C01: 3, C10: 1 },
    doctorModel: "gpt-6-luna",
    patientModel: "gpt-6-luna",
    mode: "replay",
  });
  assert.ok(launch.args.includes("C01=3,C10=1"));
  assert.equal(estimateCalls("api", 3, 200), 180);
  assert.equal(estimateCalls("api", 4, 200), 200);
  assert.equal(estimateCalls("replay", 4, 200), 0);
});
