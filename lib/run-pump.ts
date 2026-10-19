import { signPayload } from "./auth";
import { CONTINUE_HEADER, continuePayload } from "./durable-run";

export async function enqueuePump(id: string, origin: string): Promise<void> {
  const secret = process.env.AUTH_SECRET || "";
  if (!secret || !origin) return;
  const token = await signPayload(secret, continuePayload(id));
  const res = await fetch(`${origin.replace(/\/$/, "")}/api/runs/${id}/continue`, {
    method: "POST",
    headers: { [CONTINUE_HEADER]: token },
  });
  if (!res.ok) {
    throw new Error(`pump_enqueue_${res.status}`);
  }
}
