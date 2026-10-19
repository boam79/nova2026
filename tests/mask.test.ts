import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoSecrets, maskText, scrubValue } from "../lib/mask.ts";

test("masks openai-looking keys", () => {
  const raw = "header sk-abcdefghijklmnopqrstuvwxyz123456 footer";
  const masked = maskText(raw);
  assert.equal(masked.includes("sk-abcdefghijklmnopqrstuvwxyz123456"), false);
  assert.ok(masked.includes("sk-***"));
});

test("strips provided secrets", () => {
  const secret = "sk-live-SUPERSECRETKEY99";
  assert.equal(maskText(`x${secret}y`, [secret]), "x***y");
});

test("assertNoSecrets throws when a test key remains", () => {
  const secret = "sk-live-SUPERSECRETKEY99";
  assert.throws(() => assertNoSecrets({ log: secret }, [secret]));
  assert.doesNotThrow(() => assertNoSecrets({ log: "ok" }, [secret]));
});

test("scrubValue drops key-named fields", () => {
  const out = scrubValue({ doctorKey: "sk-abc", note: "hi sk-abcdefghijklmnopqrstuvwxyz" }, []);
  assert.equal("doctorKey" in (out as object), false);
  assert.equal((out as { note: string }).note.includes("sk-***"), true);
});
