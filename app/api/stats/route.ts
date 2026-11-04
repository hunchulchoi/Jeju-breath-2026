import { getDb } from "@/lib/db";
import { error, json } from "@/lib/http";
import { getStats, parseStatsDays } from "@/lib/stats";
import { seoulDay } from "@/lib/time";

export async function GET(req: Request) {
  const days = parseStatsDays(new URL(req.url).searchParams.get("days"));
  if (days === null) return error("days는 1, 7, 30 중 하나여야 해요.");
  return json(await getStats(await getDb(), { days, today: seoulDay(new Date()) }));
}
