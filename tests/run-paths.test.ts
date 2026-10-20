import assert from "node:assert/strict";
import { test } from "node:test";
import { guessMetaPaths, kstDate } from "../lib/run-paths.ts";

const ID = "43d2c846-37cf-4918-99b2-8dccfb15618f";

test("guessed meta paths stay on nearby kst dates and never list the whole store", () => {
  const now = new Date("2026-10-19T15:30:00.000Z");
  const paths = guessMetaPaths(ID, now);
  assert.equal(paths[0], `runs/${kstDate(now)}/${ID}/meta.json`);
  assert.equal(paths.every((p) => p.endsWith(`/${ID}/meta.json`)), true);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.length >= 2);
  assert.ok(paths.some((p) => p.includes("2026-10-20")));
});
