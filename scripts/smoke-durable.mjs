#!/usr/bin/env node
/**
 * HTTPS smoke: start a run, do not poll (as if the window closed), then reattach.
 * Never uses localhost. Base URL is SMOKE_URL (default production).
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
if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(BASE)) {
  console.error(JSON.stringify({ fail: "localhost_forbidden", base: BASE }));
  process.exit(1);
}

const ZIP = process.env.SMOKE_ZIP || "";
const cookieJar = new Map();
const report = { base: BASE, steps: [] };

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

const homeAnon = await req("/");
report.steps.push({
  step: "home_anon",
  status: homeAnon.status,
  location: homeAnon.headers.get("location"),
});
if (![301, 302, 307, 308].includes(homeAnon.status) || !String(homeAnon.headers.get("location") || "").includes("/login")) {
  report.fail = "login_gate";
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
  report.fail = "login";
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

const home = await req("/");
const html = await home.text();
report.steps.push({
  step: "home_reconnect_copy",
  status: home.status,
  hasStorageKey: html.includes("nova_active_run") || html.includes("resumeRunView"),
  hasDurableHint: html.includes("서버에서 이어"),
});

if (!ZIP || !existsSync(ZIP)) {
  report.skip = "no_smoke_zip";
  report.pass = "partial";
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const zipBuf = readFileSync(ZIP);
const blob = await put(`uploads/smoke-durable.zip`, zipBuf, {
  access: "private",
  addRandomSuffix: true,
  contentType: "application/zip",
});
const started = await req("/api/runs", {
  method: "POST",
  body: JSON.stringify({
    zipPath: blob.pathname,
    candidate: "smoke-durable",
    cases: ["C01"],
    reps: 1,
    mode: "replay",
    doctorKey: "",
    patientKey: "",
  }),
});
const startJson = await started.json().catch(() => ({}));
report.steps.push({
  step: "start_run",
  status: started.status,
  id: startJson.id || null,
  queued: startJson.meta?.status || null,
  error: startJson.error || null,
});
if (!started.ok || !startJson.id) {
  report.fail = "start_run";
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

const id = startJson.id;
const disconnectMs = Number(process.env.SMOKE_DISCONNECT_MS || 25000);
await new Promise((r) => setTimeout(r, disconnectMs));
report.steps.push({ step: "disconnected_wait_ms", ms: disconnectMs });

const reattach = await req(`/api/runs/${id}`);
const reattachJson = await reattach.json().catch(() => ({}));
const reStatus = reattachJson.meta?.status || "";
report.steps.push({
  step: "reattach",
  http: reattach.status,
  status: reStatus,
  turns: Array.isArray(reattachJson.progress) ? reattachJson.progress.length : 0,
  error: reattachJson.meta?.error || reattachJson.error || null,
});
if (String(reattachJson.meta?.error || "").includes("샌드박스가 끊겼")) {
  report.fail = "disconnected_aborted_run";
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

let last = reattachJson;
const deadline = Date.now() + 8 * 60 * 1000;
while (Date.now() < deadline) {
  const st = last.meta?.status;
  if (st === "done" || st === "error" || st === "stopped") break;
  await new Promise((r) => setTimeout(r, 2000));
  const poll = await req(`/api/runs/${id}`);
  last = await poll.json().catch(() => ({}));
}
report.last = {
  status: last.meta?.status || null,
  turns: Array.isArray(last.progress) ? last.progress.length : 0,
  error: last.meta?.error || last.error || null,
};
if (last?.meta?.status !== "done") {
  report.fail = "run_not_done";
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

report.pass = true;
console.log(JSON.stringify(report, null, 2));
