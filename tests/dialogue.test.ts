import assert from "node:assert/strict";
import { test } from "node:test";
import { isSandboxStoppedPayload, transcriptsFromProgress, usableProgress } from "../lib/dialogue.ts";
import type { ProgressEvent } from "../lib/types.ts";

const stopped = '{"error":{"code":"sandbox_stopped","message":"Sandbox has stopped execution and is no longer available"}}';

test("sandbox stop payload is not a transcript", () => {
  assert.equal(isSandboxStoppedPayload(stopped), true);
  assert.equal(isSandboxStoppedPayload('{"kind":"say","turn":1,"doctor":"어디가 아프세요?","patient":"배가 아파요."}'), false);
});

test("progress becomes one transcript per case, including an unfinished case", () => {
  const events: ProgressEvent[] = [
    { kind: "case_start", turn: 0, calls: 0, doctor: "", patient: "", case: "C01_r1" },
    { kind: "say", turn: 1, calls: 1, doctor: "어디가 아프세요?", patient: "배가 아파요." },
    { kind: "exam", turn: 2, calls: 1, doctor: "복부 촉진", patient: "압통이 있습니다." },
    { kind: "case_end", turn: 0, calls: 0, doctor: "", patient: "", case: "C01_r1", ok: true },
    { kind: "case_start", turn: 0, calls: 0, doctor: "", patient: "", case: "C03_r1" },
    { kind: "say", turn: 1, calls: 1, doctor: "언제부터였나요?", patient: "어제부터요." },
  ];
  const built = transcriptsFromProgress(events);
  assert.equal(built.length, 2);
  assert.equal(built[0].label, "C01_r1");
  assert.equal(built[0].closed, true);
  assert.equal(built[0].doc.partial, false);
  assert.equal(built[0].doc.turns?.length, 2);
  assert.equal(built[0].doc.turns?.[1].action, "EXAM");
  assert.equal(built[1].label, "C03_r1");
  assert.equal(built[1].closed, false);
  assert.equal(built[1].doc.partial, true);
  assert.equal(built[1].doc.turns?.[0].response, "어제부터요.");
});

test("a sandbox error object is dropped from progress", () => {
  const events = usableProgress([
    { kind: "say", turn: 1, calls: 1, doctor: "안녕하세요", patient: "네" },
    JSON.parse(stopped) as ProgressEvent,
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "say");
});
