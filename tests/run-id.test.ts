import assert from "node:assert/strict";
import { test } from "node:test";
import { isRunId, parseRunIdFromSearch, restoreRunId, searchWithRunId } from "../lib/run-id.ts";

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
