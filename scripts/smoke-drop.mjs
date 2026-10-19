#!/usr/bin/env node
/**
 * Production HTTPS drag-drop smoke. Prints PASS/FAIL only. No secrets.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

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

const zipB64 = readFileSync(ZIP).toString("base64");
const zipName = "submission-v6.5.zip";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(60000);

try {
  const password = process.env.APP_PASSWORD || "";
  if (!password) {
    console.log("FAIL missing_app_password");
    await browser.close();
    process.exit(1);
  }
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "들어가기" }).click();
  await page.getByRole("heading", { name: "제출 ZIP" }).waitFor();

  const dropResult = await page.evaluate(async ({ zipB64, zipName }) => {
    const bin = atob(zipB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], zipName, { type: "application/zip" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const zone = document.querySelector(".drop");
    if (!zone) return { ok: false, reason: "no_drop_zone", files: dt.files.length };
    zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { ok: true, files: dt.files.length, name: dt.files[0]?.name || "" };
  }, { zipB64, zipName });

  if (!dropResult.ok || dropResult.files < 1) {
    console.log("FAIL drop_event");
    await browser.close();
    process.exit(1);
  }

  const passed = page.locator("text=검증 통과");
  const failed = page.locator("text=검증 실패");
  await Promise.race([
    passed.waitFor({ timeout: 45000 }),
    failed.waitFor({ timeout: 45000 }),
  ]).catch(() => undefined);

  const body = await page.locator("body").innerText();
  const ok = body.includes("검증 통과") && body.includes(zipName);
  const bad = body.includes("검증 실패");
  if (ok && !bad) {
    console.log("PASS");
    await browser.close();
    process.exit(0);
  }
  console.log("FAIL validate");
  await browser.close();
  process.exit(1);
} catch {
  console.log("FAIL exception");
  await browser.close();
  process.exit(1);
}
