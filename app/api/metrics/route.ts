import { getDb } from "@/lib/db";
import { dayParam, error, json } from "@/lib/http";
import { getMetrics } from "@/lib/reports";

export async function GET(req: Request) {
  const day = dayParam(req);
  if (!day) return error("date는 YYYY-MM-DD 형식이어야 해요.");
  return json(await getMetrics(await getDb(), day));
}
