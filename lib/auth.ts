import { GATE_COOKIE } from "./constants.ts";

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(sig);
}

export async function makeGateToken(secret: string): Promise<string> {
  const payload = `v1.${Date.now()}`;
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyGateToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = await hmac(secret, payload);
  if (expect.length !== sig.length) return false;
  let diff = 0;
  for (let n = 0; n < expect.length; n++) diff |= expect.charCodeAt(n) ^ sig.charCodeAt(n);
  return diff === 0;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

export async function signPayload(secret: string, payload: string): Promise<string> {
  return hmac(secret, payload);
}

export async function verifySignedPayload(secret: string, payload: string, sig: string | undefined): Promise<boolean> {
  if (!secret || !sig) return false;
  const expect = await hmac(secret, payload);
  return timingSafeEqual(expect, sig);
}

export { GATE_COOKIE, fromB64url };
