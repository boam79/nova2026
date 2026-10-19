#!/usr/bin/env node
/**
 * M0 spike: run nova_local_runner.py inside Vercel Sandbox.
 * 1) Replay C01 with deny-all egress — one consult must finish.
 * 2) Allow-list firewall — api.openai.com reachable, contest hosts blocked.
 *
 * Does not print secrets. Reads bank/ZIP from env (never from git).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Sandbox } from "@vercel/sandbox";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_RUNNER = join(ROOT, "vendor", "nova_local_runner.py");
const OUT_DIR = join(ROOT, "_local", "m0");

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

function loadVercelIds() {
  const p = join(ROOT, ".vercel", "project.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function loadCliToken() {
  const p = join(homedir(), "Library/Application Support/com.vercel.cli/auth.json");
  if (!existsSync(p)) return "";
  try {
    const d = JSON.parse(readFileSync(p, "utf8"));
    return typeof d.token === "string" ? d.token : "";
  } catch {
    return "";
  }
}

function mask(text) {
  return String(text || "")
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/Bearer [A-Za-z0-9_\-\.]+/g, "Bearer ***");
}

function summarize(exitCode, stdout, stderr) {
  const text = mask(`${stdout || ""}\n${stderr || ""}`);
  const lines = text.split("\n").filter(Boolean);
  const tail = lines.slice(-40).join("\n");
  return { exitCode, lineCount: lines.length, tail };
}

loadDotEnv(join(ROOT, ".env.local"));
loadDotEnv(join(ROOT, ".env"));

const bankPath = resolve(mustEnv("BANK_C01"));
const zipPath = resolve(mustEnv("SUBMISSION_ZIP"));
if (!existsSync(VENDOR_RUNNER)) throw new Error("vendor/nova_local_runner.py missing");
if (!existsSync(bankPath)) throw new Error("BANK_C01 not found");
if (!existsSync(zipPath)) throw new Error("SUBMISSION_ZIP not found");

const ids = loadVercelIds();
const token = process.env.VERCEL_TOKEN || loadCliToken();
const teamId = process.env.VERCEL_TEAM_ID || ids.orgId;
const projectId = process.env.VERCEL_PROJECT_ID || ids.projectId;
const auth = token && teamId && projectId ? { token, teamId, projectId } : {};
if (!auth.token && !process.env.VERCEL_OIDC_TOKEN) {
  console.error("Need VERCEL_OIDC_TOKEN (vercel env pull) or VERCEL_TOKEN + linked project");
  process.exit(2);
}

mkdirSync(OUT_DIR, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  replay: null,
  firewall: null,
  pass: false,
};

async function withSandbox(opts, fn) {
  const sandbox = await Sandbox.create({
    persistent: false,
    timeout: 15 * 60 * 1000,
    resources: { vcpus: 2 },
    ...auth,
    ...opts,
  });
  try {
    return await fn(sandbox);
  } finally {
    await sandbox.stop();
  }
}

async function runReplay() {
  console.log("M0-1 replay: deny-all, C01 offline");
  return withSandbox({ networkPolicy: "deny-all" }, async (sandbox) => {
    await sandbox.mkDir("bank");
    await sandbox.mkDir("runs");
    await sandbox.writeFiles([
      { path: "nova_local_runner.py", content: readFileSync(VENDOR_RUNNER), mode: 0o644 },
      { path: "bank/C01.json", content: readFileSync(bankPath) },
      { path: "submission.zip", content: readFileSync(zipPath) },
    ]);
    const result = await sandbox.runCommand({
      cmd: "python3",
      args: [
        "/vercel/sandbox/nova_local_runner.py",
        "--zip",
        "/vercel/sandbox/submission.zip",
        "--offline",
        "--cases",
        "C01",
        "--reps",
        "1",
      ],
      cwd: "/vercel/sandbox",
    });
    const stdout = await result.stdout();
    const stderr = await result.stderr();
    writeFileSync(join(OUT_DIR, "replay-log.txt"), mask(`${stdout}\n${stderr}`), "utf8");

    let transcript = null;
    const list = await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", "ls -la /vercel/sandbox/runs 2>/dev/null; find /vercel/sandbox/runs -name '*.json' | head"],
      cwd: "/vercel/sandbox",
    });
    const listing = await list.stdout();
    const jsonPath = (listing.match(/\/vercel\/sandbox\/runs\/\S+\.json/) || [])[0];
    if (jsonPath) {
      const buf = await sandbox.readFileToBuffer({ path: jsonPath });
      if (buf) {
        transcript = JSON.parse(buf.toString("utf8"));
        writeFileSync(join(OUT_DIR, "C01.transcript.json"), JSON.stringify(transcript).slice(0, 200) + "\n…truncated in report\n");
        writeFileSync(join(OUT_DIR, "C01.transcript.full.json"), buf);
      }
    }
    const turns = Array.isArray(transcript?.turns) ? transcript.turns.length : 0;
    const ok = result.exitCode === 0 && turns > 0;
    const summary = summarize(result.exitCode, stdout, stderr);
    return { ok, turns, listing: listing.trim(), ...summary };
  });
}

async function runFirewall() {
  console.log("M0-2 firewall: allow api.openai.com only");
  return withSandbox(
    { networkPolicy: { allow: { "api.openai.com": [] } } },
    async (sandbox) => {
      const probe = async (url) => {
        const r = await sandbox.runCommand({
          cmd: "python3",
          args: [
            "-c",
            "import sys,urllib.error,urllib.request\nurl=sys.argv[1]\ntry:\n  urllib.request.urlopen(url,timeout=20)\n  print('HTTP 200')\nexcept urllib.error.HTTPError as e:\n  print(f'HTTP {e.code}')\nexcept Exception as e:\n  print(type(e).__name__, str(e)[:180]); sys.exit(1)",
            url,
          ],
        });
        const out = mask(`${await r.stdout()}\n${await r.stderr()}`).trim();
        return { exitCode: r.exitCode, out };
      };
      const openai = await probe("https://api.openai.com/v1/models");
      const contest = await probe("https://nova.snubhai.org/");
      const openaiReachable = openai.exitCode === 0 || /HTTP (200|401|403|404)/.test(openai.out);
      const contestBlocked = contest.exitCode !== 0 && !/HTTP (200|301|302|401|403)/.test(contest.out);
      return {
        ok: openaiReachable && contestBlocked,
        openaiReachable,
        contestBlocked,
        openai,
        contest,
      };
    },
  );
}

try {
  report.replay = await runReplay();
  report.firewall = await runFirewall();
  report.pass = Boolean(report.replay?.ok && report.firewall?.ok);
} catch (err) {
  report.error = mask(err?.stack || err?.message || String(err));
  report.pass = false;
}

report.finishedAt = new Date().toISOString();
writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass: report.pass, replayOk: report.replay?.ok, turns: report.replay?.turns, firewallOk: report.firewall?.ok }, null, 2));
process.exit(report.pass ? 0 : 1);
