import { NextResponse } from "next/server";
import { GATE_COOKIE } from "../../../lib/constants";
import { makeGateToken, timingSafeEqual } from "../../../lib/auth";

export async function POST(req: Request) {
  const password = process.env.APP_PASSWORD || "";
  const secret = process.env.AUTH_SECRET || "";
  if (!password || !secret) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!timingSafeEqual(String(body.password || ""), password)) {
    return NextResponse.json({ error: "비밀번호가 틀렸습니다." }, { status: 401 });
  }
  const token = await makeGateToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
