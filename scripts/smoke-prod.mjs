#!/usr/bin/env node
/**
 * Production HTTPS smoke for M1. Does not print secrets or API keys.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { put } from "@vercel/blob";

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

loadDotEnv(resolve(".env.local"));

const BASE = process.env.SMOKE_URL || "https://nova-web-runner.vercel.app";
const ZIP = process.env.SMOKE_ZIP || "/Users/parkjaemin/Dev/nova2026/dist/submission-v6.5.zip";

const cookieJar = new Map();

function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const single = res.headers.get("set-cookie");
  const list = raw.length ? raw : single ? [single] : [];
  for (const c of list) {
    const part = c.split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) cookieJar.set(part.slice(0, eq), part.slice(eq + 1));
  }
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: {
      ...(opts.body && typeof opts.body === "string" ? { "Content-Type": "application/json" } : {}),
      cookie: cookieHeader(),
      ...(opts.headers || {}),
    },
  });
  storeCookies(res);
  return res;
}

function looksLikeKey(text) {
  return /(?<![A-Za-z0-9])sk-[A-Za-z0-9_\-]{8,}/.test(text);
}

const report = { base: BASE, steps: [] };

const homeAnon = await req("/");
report.steps.push({
  step: "home_anon",
  status: homeAnon.status,
  location: homeAnon.headers.get("location"),
});
if (![301, 302, 307, 308].includes(homeAnon.status) || !String(homeAnon.headers.get("location") || "").includes("/login")) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

const apiAnon = await req("/api/runs");
report.steps.push({ step: "api_anon", status: apiAnon.status });
if (apiAnon.status !== 401) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

const password = process.env.APP_PASSWORD || "";
if (!password) {
  report.fail = "missing_app_password";
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
const login = await req("/api/login", { method: "POST", body: JSON.stringify({ password }) });
report.steps.push({ step: "login", status: login.status, cookie: cookieJar.has("nova_web_gate") });
if (!login.ok || !cookieJar.has("nova_web_gate")) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

const home = await req("/");
report.steps.push({ step: "home", status: home.status, location: home.headers.get("location") });
if (home.status !== 200) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

const zipBuf = readFileSync(ZIP);
const blob = await put(`uploads/smoke-submission.zip`, zipBuf, {
  access: "private",
  addRandomSuffix: true,
  contentType: "application/zip",
});
report.steps.push({ step: "blob_put", pathname: blob.pathname, size: zipBuf.byteLength });

const val = await req("/api/zip/validate", { method: "POST", body: JSON.stringify({ pathname: blob.pathname }) });
const valJson = await val.json();
report.steps.push({
  step: "zip_validate",
  status: val.status,
  ok: valJson.ok,
  issues: (valJson.issues || []).map((i) => i.message),
});
if (!valJson.ok) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

const started = await req("/api/runs", {
  method: "POST",
  body: JSON.stringify({
    zipPath: blob.pathname,
    candidate: "smoke-v65",
    cases: ["C01"],
    reps: 1,
    mode: "replay",
    doctorKey: "",
    patientKey: "",
    sameKey: true,
  }),
});
const startJson = await started.json().catch(() => ({}));
report.steps.push({
  step: "start_run",
  status: started.status,
  id: startJson.id || null,
  error: startJson.error || null,
  sandboxIdSet: Boolean(startJson.meta?.sandboxId),
});
if (!started.ok || !startJson.id) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

const id = startJson.id;
let last = null;
const deadline = Date.now() + 8 * 60 * 1000;
while (Date.now() < deadline) {
  const poll = await req(`/api/runs/${id}`);
  last = await poll.json().catch(() => ({}));
  const st = last.meta?.status;
  const turns = Array.isArray(last.progress) ? last.progress.length : 0;
  report.lastPoll = { status: poll.status, run: st, turns, error: last.meta?.error || last.error || null };
  if (st === "done" || st === "error" || st === "stopped") break;
  await new Promise((r) => setTimeout(r, 2000));
}

if (last?.meta?.status !== "done") {
  report.fail = "run_not_done";
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

const summaryRes = await req(`/api/runs/${id}/file?name=summary.json`);
const summaryText = await summaryRes.text();
const zipRes = await req(`/api/runs/${id}/file?name=result.zip`);
const zipBytes = Buffer.from(await zipRes.arrayBuffer());
const txRes = await req(`/api/runs/${id}/file?name=transcript.json&case=C01`);
const txText = await txRes.text();

const leak = looksLikeKey(summaryText) || looksLikeKey(txText) || looksLikeKey(JSON.stringify(last));
let summary;
try {
  summary = JSON.parse(summaryText);
} catch {
  summary = null;
}

report.steps.push({
  step: "artifacts",
  summaryStatus: summaryRes.status,
  zipStatus: zipRes.status,
  zipBytes: zipBytes.byteLength,
  transcriptStatus: txRes.status,
  rows: summary?.rows?.map((r) => ({ case: r.case, turns: r.turns, history: r.history, dup: r.dup, dx: r.dx })) || null,
  leak,
});

if (summaryRes.status !== 200 || zipRes.status !== 200 || txRes.status !== 200 || leak || !summary?.rows?.length) {
  report.fail = "artifacts";
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

report.pass = true;
console.log(JSON.stringify(report, null, 2));
