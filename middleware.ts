import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE } from "./lib/constants";
import { verifyGateToken } from "./lib/auth";
import { PUMP_HEADER, isContinuePath, verifyPumpSecret } from "./lib/run-pump";

const PUBLIC = new Set(["/login", "/api/login", "/robots.txt"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.has(pathname) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }
  const secret = process.env.AUTH_SECRET || "";
  if (isContinuePath(pathname) && verifyPumpSecret(req.headers.get(PUMP_HEADER), secret)) {
    return NextResponse.next();
  }
  const token = req.cookies.get(GATE_COOKIE)?.value;
  const ok = await verifyGateToken(token, secret);
  if (ok) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
