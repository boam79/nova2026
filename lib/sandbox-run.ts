import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Sandbox } from "@vercel/sandbox";
import { CALL_LIMIT_DEFAULT, CASES, MAX_CONCURRENT_RUNS, OPENAI_BASE, TURN_LIMIT, clampRep } from "./constants";
import { deletePrefix, getPrivateBuffer, putPrivate } from "./blob";
import { assertNoSecrets, maskText, scrubValue } from "./mask";
import { summarizeTranscript, transcriptToText, type Transcript, type Side } from "./summary";
import type { CaseId } from "./constants";
import { runnerLaunchArgs } from "./run-mode";
import { BusyError, parseLock, admitRun, releaseRun, liveRuns, type LockState } from "./run-lock";
import type { ProgressEvent, RunMeta, RunMode, RunStatus } from "./types";

const RUNNER = join(process.cwd(), "vendor", "nova_local_runner.py");
const DISCLAIMER = "점수가 아니라 대화록에서 센 값이다. 공식 점수로 쓰지 마세요.";

function kstDate(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function metaPath(meta: Pick<RunMeta, "createdAt" | "id">): string {
  return `runs/${kstDate(new Date(meta.createdAt))}/${meta.id}/meta.json`;
}

export function runPrefix(meta: Pick<RunMeta, "createdAt" | "id">): string {
  return `runs/${kstDate(new Date(meta.createdAt))}/${meta.id}/`;
}

export async function saveMeta(meta: RunMeta, secrets: string[] = []): Promise<void> {
  const clean = scrubValue({ ...meta, disclaimer: DISCLAIMER }, secrets);
  assertNoSecrets(clean, secrets);
  await putPrivate(metaPath(meta), JSON.stringify(clean, null, 2), "application/json");
}

export async function loadMeta(id: string): Promise<RunMeta | null> {
  const blobs = await (await import("./blob")).listPrefix("runs/");
  const hit = blobs.find((b) => b.pathname.endsWith(`/${id}/meta.json`));
  if (!hit) return null;
  const buf = await getPrivateBuffer(hit.pathname);
  if (!buf) return null;
  return JSON.parse(buf.toString("utf8")) as RunMeta;
}

export async function listMetas(): Promise<RunMeta[]> {
  const blobs = await (await import("./blob")).listPrefix("runs/");
  const metas = blobs.filter((b) => b.pathname.endsWith("/meta.json"));
  const out: RunMeta[] = [];
  for (const b of metas) {
    const buf = await getPrivateBuffer(b.pathname);
    if (buf) out.push(JSON.parse(buf.toString("utf8")) as RunMeta);
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

async function readLockState(): Promise<LockState> {
  const existing = await getPrivateBuffer("lock.json");
  if (!existing) return { runs: [] };
  try {
    return parseLock(JSON.parse(existing.toString("utf8")));
  } catch {
    return { runs: [] };
  }
}

export async function lockSnapshot(): Promise<{ inFlight: number; max: number; ids: string[] }> {
  const live = liveRuns(await readLockState(), new Date());
  return { inFlight: live.length, max: MAX_CONCURRENT_RUNS, ids: live.map((r) => r.id) };
}

async function writeLock(state: LockState): Promise<void> {
  if (!state.runs.length) {
    await deletePrefix("lock.json");
    return;
  }
  await putPrivate("lock.json", JSON.stringify(state), "application/json");
}

export async function acquireLock(runId: string): Promise<{ ok: boolean; inFlight: number; max: number }> {
  for (let i = 0; i < 8; i++) {
    const result = admitRun(await readLockState(), runId, new Date());
    if (!result.ok) {
      await writeLock(result.state);
      return { ok: false, inFlight: result.state.runs.length, max: MAX_CONCURRENT_RUNS };
    }
    await writeLock(result.state);
    const confirm = liveRuns(await readLockState(), new Date());
    if (confirm.some((r) => r.id === runId)) {
      return { ok: true, inFlight: confirm.length, max: MAX_CONCURRENT_RUNS };
    }
    await new Promise((r) => setTimeout(r, 40 + i * 40));
  }
  const live = liveRuns(await readLockState(), new Date());
  return { ok: live.some((r) => r.id === runId), inFlight: live.length, max: MAX_CONCURRENT_RUNS };
}

export async function releaseLock(runId: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const next = releaseRun(await readLockState(), runId);
    await writeLock(next);
    const confirm = liveRuns(await readLockState(), new Date());
    if (!confirm.some((r) => r.id === runId)) return;
    await new Promise((r) => setTimeout(r, 40 + i * 40));
  }
}

async function writeSandboxFiles(
  sandbox: Sandbox,
  zipBuf: Buffer,
  cases: CaseId[],
  settings: Record<string, unknown>,
) {
  const files: { path: string; content: Buffer }[] = [
    { path: "nova_local_runner.py", content: readFileSync(RUNNER) },
    { path: "submission.zip", content: zipBuf },
    { path: "settings.json", content: Buffer.from(JSON.stringify(settings)) },
  ];
  for (const cid of cases) {
    const bank = await getPrivateBuffer(`bank/${cid}.json`);
    if (!bank) throw new Error(`bank_${cid}_missing`);
    files.push({ path: `bank/${cid}.json`, content: bank });
  }
  await sandbox.mkDir("bank").catch(() => undefined);
  await sandbox.mkDir("runs").catch(() => undefined);
  await sandbox.writeFiles(files.map((f) => ({ ...f, mode: 0o644 })));
}

export async function startRun(opts: {
  zipPath: string;
  candidate: string;
  cases: CaseId[];
  reps: number;
  repsByCase?: Partial<Record<CaseId, number>>;
  mode: RunMode;
  doctorKey: string;
  patientKey: string;
  doctorModel: string;
  patientModel: string;
  callLimit: number;
}): Promise<RunMeta> {
  const id = crypto.randomUUID();
  const locked = await acquireLock(id);
  if (!locked.ok) throw new BusyError(locked.inFlight, locked.max);
  const zipBuf = await getPrivateBuffer(opts.zipPath);
  if (!zipBuf) {
    await releaseLock(id);
    throw new Error("zip_missing");
  }
  const cases = opts.cases.filter((c) => (CASES as readonly string[]).includes(c));
  if (!cases.length) {
    await releaseLock(id);
    throw new Error("cases");
  }
  const repsByCase = Object.fromEntries(
    (cases as CaseId[]).map((c) => [c, clampRep(opts.repsByCase?.[c] ?? opts.reps ?? 1)]),
  ) as Partial<Record<CaseId, number>>;
  const meta: RunMeta = {
    id,
    createdAt: new Date().toISOString(),
    candidate: opts.candidate.replace(/[^\w.\-가-힣]+/g, "_").slice(0, 80),
    zipPath: opts.zipPath,
    cases: cases as CaseId[],
    reps: Math.max(...Object.values(repsByCase).map((n) => n || 1)),
    repsByCase,
    mode: opts.mode,
    doctorModel: opts.doctorModel,
    patientModel: opts.patientModel,
    callLimit: Math.max(1, Math.min(CALL_LIMIT_DEFAULT, opts.callLimit || CALL_LIMIT_DEFAULT)),
    status: "running",
    sandboxId: "",
    disclaimer: DISCLAIMER,
  };
  const secrets = [opts.doctorKey, opts.patientKey].filter((k) => k && k.length >= 8);
  await saveMeta(meta, secrets);

  const networkPolicy = opts.mode === "api" ? { allow: ["api.openai.com"] } : "deny-all";

  let sandbox: Sandbox | undefined;
  try {
    sandbox = await Sandbox.create({
      timeout: 120 * 60 * 1000,
      resources: { vcpus: 2 },
      networkPolicy,
      ...(opts.mode === "api" && (opts.doctorKey || opts.patientKey)
        ? {
            env: {
              ...(opts.doctorKey ? { NOVA_LOCAL_DOCTOR_KEY: opts.doctorKey } : {}),
              ...(opts.patientKey ? { NOVA_LOCAL_PATIENT_KEY: opts.patientKey } : {}),
            },
          }
        : {}),
    });
    meta.sandboxId = sandbox.sandboxId;
    await saveMeta(meta, secrets);
    await writeSandboxFiles(sandbox, zipBuf, cases as CaseId[], {
      base_url: OPENAI_BASE,
      doctor_model: opts.doctorModel,
      patient_model: opts.patientModel,
      timeout: 240,
      call_limit: meta.callLimit,
    });
    const launch = runnerLaunchArgs({
      cases,
      repsByCase: repsByCase as Record<string, number>,
      doctorModel: opts.doctorModel,
      patientModel: opts.patientModel,
      mode: opts.mode,
    });
    const args = launch.args;
    const env: Record<string, string> = {
      PYTHONIOENCODING: "utf-8",
      NOVA_LOCAL_PROGRESS: "/vercel/sandbox/progress.jsonl",
    };
    if (launch.passKeys) {
      if (opts.doctorKey) env.NOVA_LOCAL_DOCTOR_KEY = opts.doctorKey;
      if (opts.patientKey) env.NOVA_LOCAL_PATIENT_KEY = opts.patientKey;
    }
    await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        "python3 " +
          args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ") +
          " > /vercel/sandbox/run_stdout.txt 2>&1; echo $? > /vercel/sandbox/exit_code.txt",
      ],
      detached: true,
      cwd: "/vercel/sandbox",
      env,
    });
    return meta;
  } catch (err) {
    meta.status = "error";
    meta.error = maskText(String((err as Error).message || err), secrets);
    await saveMeta(meta, secrets);
    await releaseLock(id);
    if (sandbox) await sandbox.stop().catch(() => undefined);
    throw err;
  }
}

async function readSandboxText(sandbox: Sandbox, path: string): Promise<string> {
  const buf = await sandbox.readFileToBuffer({ path });
  return buf ? buf.toString("utf8") : "";
}

export function parseProgress(text: string): ProgressEvent[] {
  const events: ProgressEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as ProgressEvent);
    } catch {
      /* skip */
    }
  }
  return events;
}

export async function pollRun(meta: RunMeta, secrets: string[] = []): Promise<{
  meta: RunMeta;
  progress: ProgressEvent[];
  log: string;
}> {
  if (!meta.sandboxId) {
    return { meta, progress: [], log: "sandbox 없음" };
  }
  const sandbox = await Sandbox.get({ sandboxId: meta.sandboxId });
  const progressText = await readSandboxText(sandbox, "/vercel/sandbox/progress.jsonl");
  const log = maskText(await readSandboxText(sandbox, "/vercel/sandbox/run_stdout.txt"), secrets);
  const exitRaw = (await readSandboxText(sandbox, "/vercel/sandbox/exit_code.txt")).trim();
  const progress = parseProgress(maskText(progressText, secrets));
  if (progressText) {
    await putPrivate(`${runPrefix(meta)}progress.jsonl`, maskText(progressText, secrets), "application/x-ndjson");
  }
  if (exitRaw !== "") {
    const code = Number(exitRaw);
    try {
      if (code === 0) await harvest(sandbox, meta, secrets);
      else {
        meta.status = "error";
        meta.error = maskText(log.slice(-400) || `exit ${code}`, secrets);
        await saveMeta(meta, secrets);
        await releaseLock(meta.id);
        await sandbox.stop().catch(() => undefined);
      }
    } catch (err) {
      meta.status = "error";
      meta.error = maskText(String((err as Error).message || err), secrets);
      await saveMeta(meta, secrets);
      await releaseLock(meta.id);
      await sandbox.stop().catch(() => undefined);
    }
  }
  return { meta, progress, log };
}

async function harvest(sandbox: Sandbox, meta: RunMeta, secrets: string[]): Promise<void> {
  const prefix = runPrefix(meta);
  const list = await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", "find /vercel/sandbox/runs -type f | sort"],
  });
  const listing = await list.stdout();
  const rows = [];
  const jsonFiles = listing.split("\n").filter((p) => p.endsWith(".json") && p.includes("/transcripts/"));
  for (const p of jsonFiles) {
    if (p.endsWith(".local.json")) continue;
    const buf = await sandbox.readFileToBuffer({ path: p });
    if (!buf) continue;
    const label = p.split("/").pop()?.replace(/\.json$/, "") || "case";
    const doc = JSON.parse(maskText(buf.toString("utf8"), secrets)) as Transcript;
    let side: Side = {};
    const sideBuf = await sandbox.readFileToBuffer({ path: p.replace(/\.json$/, ".local.json") });
    if (sideBuf) {
      side = JSON.parse(maskText(sideBuf.toString("utf8"), secrets)) as Side;
    }
    const summary = summarizeTranscript(label, doc, side);
    rows.push(summary);
    const jsonOut = JSON.stringify(scrubValue(doc, secrets), null, 2);
    const textOut = maskText(transcriptToText(doc), secrets);
    assertNoSecrets(jsonOut, secrets);
    assertNoSecrets(textOut, secrets);
    await putPrivate(`${prefix}transcripts/${label}.json`, jsonOut, "application/json");
    await putPrivate(`${prefix}transcripts/${label}.txt`, textOut, "text/plain; charset=utf-8");
  }
  const summary = { disclaimer: DISCLAIMER, candidate: meta.candidate, cases: meta.cases, rows };
  assertNoSecrets(summary, secrets);
  await putPrivate(`${prefix}summary.json`, JSON.stringify(summary, null, 2), "application/json");
  const zipHit = listing.split("\n").find((p) => p.includes("결과_") && p.endsWith(".zip"));
  if (zipHit) {
    const zbuf = await sandbox.readFileToBuffer({ path: zipHit });
    if (zbuf) {
      assertNoSecrets(zbuf.toString("utf8", 0, Math.min(zbuf.length, 20000)), secrets);
      await putPrivate(`${prefix}result.zip`, zbuf, "application/zip");
    }
  }
  meta.status = "done";
  meta.summary = summary;
  await saveMeta(meta, secrets);
  await releaseLock(meta.id);
  await sandbox.stop().catch(() => undefined);
}

export async function stopRun(meta: RunMeta): Promise<RunMeta> {
  try {
    const sandbox = await Sandbox.get({ sandboxId: meta.sandboxId });
    await sandbox.stop();
  } catch {
    /* already gone */
  }
  meta.status = "stopped";
  await saveMeta(meta);
  await releaseLock(meta.id);
  return meta;
}

export async function deleteRun(meta: RunMeta): Promise<void> {
  try {
    const sandbox = await Sandbox.get({ sandboxId: meta.sandboxId });
    await sandbox.stop();
  } catch {
    /* ignore */
  }
  await deletePrefix(runPrefix(meta));
  await releaseLock(meta.id);
}

export { DISCLAIMER, TURN_LIMIT };
