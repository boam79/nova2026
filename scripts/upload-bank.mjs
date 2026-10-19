#!/usr/bin/env node
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
const dir = resolve(process.env.BANK_DIR || "");
if (!dir) {
  console.error("BANK_DIR=/path/to/bank npm run upload-bank");
  process.exit(2);
}
for (const cid of ["C01", "C03", "C10"]) {
  const buf = readFileSync(resolve(dir, `${cid}.json`));
  const blob = await put(`bank/${cid}.json`, buf, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  console.log("uploaded", cid, blob.pathname);
}
