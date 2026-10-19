import { after, NextResponse } from "next/server";
import { chainPump, loadMeta, pumpUntilBudget } from "../../../../../lib/sandbox-run";
import { PUMP_HEADER, shouldKeepPumping, verifyPumpSecret } from "../../../../../lib/run-pump";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const secret = process.env.AUTH_SECRET || "";
  if (!verifyPumpSecret(req.headers.get(PUMP_HEADER), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const meta = await loadMeta(id);
  if (!meta) return NextResponse.json({ error: "없음" }, { status: 404 });
  if (!shouldKeepPumping(meta.status)) {
    return NextResponse.json({ ok: true, status: meta.status });
  }
  after(async () => {
    const latest = await pumpUntilBudget(id);
    if (latest && shouldKeepPumping(latest.status) && latest.sandboxId) await chainPump(id);
  });
  return NextResponse.json({ ok: true, status: meta.status });
}
