import { NextResponse } from "next/server";
import { GATE_COOKIE } from "../../../lib/constants";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, "", { httpOnly: true, secure: true, path: "/", maxAge: 0 });
  return res;
}
