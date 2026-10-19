import assert from "node:assert/strict";
import { test } from "node:test";
import { isRunId, parseRunIdFromSearch, restoreRunId, searchWithRunId, shouldClearSavedRun, shouldResumeSavedRun } from "../lib/run-id.ts";

const ID = "679c674d-bbe2-4b2b-a6bc-b08ee9b7105a";

test("only a uuid is a run id", () => {
  assert.equal(isRunId(ID), true);
  assert.equal(isRunId("nope"), false);
  assert.equal(isRunId(""), false);
});

test("query string run id wins over localStorage", () => {
  assert.equal(parseRunIdFromSearch(`?run=${ID}&x=1`), ID);
  assert.equal(parseRunIdFromSearch("?run=not-an-id"), "");
  assert.equal(restoreRunId(`?run=${ID}`, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), ID);
  assert.equal(restoreRunId("", ID), ID);
  assert.equal(restoreRunId("", "stale"), "");
});

test("client can put the run id back on the url", () => {
  assert.equal(searchWithRunId("", ID), `?run=${ID}`);
  assert.equal(searchWithRunId("?foo=1", ID), `?foo=1&run=${ID}`);
  assert.equal(searchWithRunId(`?run=${ID}`, ""), "");
});

test("login restore only reattaches queued or running runs", () => {
  assert.equal(shouldResumeSavedRun("queued"), true);
  assert.equal(shouldResumeSavedRun("running"), true);
  assert.equal(shouldResumeSavedRun("done"), false);
  assert.equal(shouldResumeSavedRun("error"), false);
  assert.equal(shouldResumeSavedRun("stopped"), false);
  assert.equal(shouldResumeSavedRun(""), false);
  assert.equal(shouldResumeSavedRun(undefined), false);
});

test("login restore clears finished or missing runs, not server errors", () => {
  assert.equal(shouldClearSavedRun(200, "done"), true);
  assert.equal(shouldClearSavedRun(200, "error"), true);
  assert.equal(shouldClearSavedRun(200, "stopped"), true);
  assert.equal(shouldClearSavedRun(200, ""), true);
  assert.equal(shouldClearSavedRun(200, "queued"), false);
  assert.equal(shouldClearSavedRun(200, "running"), false);
  assert.equal(shouldClearSavedRun(404, undefined), true);
  assert.equal(shouldClearSavedRun(401, undefined), false);
  assert.equal(shouldClearSavedRun(500, "running"), false);
});
