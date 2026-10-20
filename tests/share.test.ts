import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicPath, parseShareId, shareMarkdown, sharePath, shareRawPath } from "../lib/share.ts";

const ID = "679c674d-bbe2-4b2b-a6bc-b08ee9b7105a";

test("share paths are public capability urls, not a listing", () => {
  assert.equal(isPublicPath("/share"), true);
  assert.equal(isPublicPath(`/share/${ID}`), true);
  assert.equal(isPublicPath(`/share/${ID}/raw`), true);
  assert.equal(isPublicPath("/login"), true);
  assert.equal(isPublicPath("/"), false);
  assert.equal(isPublicPath("/runs"), false);
  assert.equal(isPublicPath(`/runs/${ID}`), false);
  assert.equal(isPublicPath(`/api/runs/${ID}/file`), false);
  assert.deepEqual(parseShareId(`/share/${ID}`), { id: ID, raw: false });
  assert.equal(parseShareId(`/share/${ID}/raw`)?.raw, true);
  assert.equal(parseShareId("/share"), null);
  assert.equal(parseShareId("/share/not-an-id"), null);
  assert.equal(sharePath(ID), `/share/${ID}`);
  assert.equal(shareRawPath(ID), `/share/${ID}/raw`);
});

test("share markdown is dialogue only and never a zip or key", () => {
  const md = shareMarkdown({
    id: ID,
    candidate: "submission-v10",
    status: "done",
    mode: "api",
    createdAt: "2026-10-19T12:00:00.000Z",
    doctorModel: "gpt-6-luna",
    patientModel: "gpt-6-luna",
    transcripts: [
      { case: "C01", text: "의사: 어디가 불편하세요?\n환자: 잠을 못 잡니다.\n진단: 졸피뎀 사용장애" },
    ],
  });
  assert.match(md, /NOVA 대화록/);
  assert.match(md, /submission-v10/);
  assert.match(md, /## C01/);
  assert.match(md, /어디가 불편하세요/);
  assert.match(md, /공식 점수로 쓰지 마세요/);
  assert.equal(md.includes("zipPath"), false);
  assert.equal(md.includes("result.zip"), false);
  assert.equal(md.includes("sk-"), false);
  assert.equal(md.includes("sandboxId"), false);
});
