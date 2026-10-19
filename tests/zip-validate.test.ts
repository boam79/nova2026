import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { validateSubmissionZip } from "../lib/zip-validate.ts";
import { estimateCalls } from "../lib/constants.ts";

async function pack(files: Record<string, string>): Promise<{ buf: Uint8Array; size: number }> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  const buf = await zip.generateAsync({ type: "uint8array" });
  return { buf, size: buf.byteLength };
}

const good = {
  "run.py": "print('ok')\n",
  "nova_sdk.py": "class Client: pass\n",
  "requirements.txt": "none==0\n",
};

test("accepts a minimal submission zip", async () => {
  const { buf, size } = await pack(good);
  const r = await validateSubmissionZip(buf, size);
  assert.equal(r.ok, true, r.issues.map((i) => i.message).join("; "));
});

test("rejects missing run.py", async () => {
  const { buf, size } = await pack({ "nova_sdk.py": "x", "requirements.txt": "none==0" });
  const r = await validateSubmissionZip(buf, size);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.message.includes("run.py")));
});

test("rejects path traversal", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "nwr-"));
  const zipPath = join(dir, "evil.zip");
  execFileSync("python3", [
    "-c",
    "import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w')\nz.writestr('../escape.py','x')\nz.writestr('run.py','print(1)')\nz.writestr('nova_sdk.py','x')\nz.writestr('requirements.txt','none==0')\nz.close()",
    zipPath,
  ]);
  const buf = readFileSync(zipPath);
  const r = await validateSubmissionZip(buf, buf.byteLength);
  assert.equal(r.ok, false, r.issues.map((i) => i.message).join("; "));
  assert.ok(r.issues.some((i) => i.message.includes("경로 탈출")));
});

test("rejects external openai host in source", async () => {
  const { buf, size } = await pack({
    ...good,
    "run.py": 'url = "https://api.openai.com/v1"\n',
  });
  const r = await validateSubmissionZip(buf, size);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /openai|주소/.test(i.message)));
});

test("rejects contest domain", async () => {
  const { buf, size } = await pack({
    ...good,
    "run.py": 'base = "https://nova.snubhai.org"\n',
  });
  const r = await validateSubmissionZip(buf, size);
  assert.equal(r.ok, false);
});

test("allows snubhai mention only in a comment", async () => {
  const { buf, size } = await pack({
    ...good,
    "nova_sdk.py": "# nova.snubhai.org refuses urllib default UA\nclass Client: pass\n",
  });
  const r = await validateSubmissionZip(buf, size);
  assert.equal(r.ok, true, r.issues.map((i) => i.message).join("; "));
});

test("replay mode estimates zero calls", () => {
  assert.equal(estimateCalls("replay", 3, 1), 0);
  assert.ok(estimateCalls("api", 1, 1) > 0);
});
