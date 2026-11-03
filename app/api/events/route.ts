import { getDb } from "@/lib/db";
import { error, json, readJson } from "@/lib/http";
import { bumpEvent } from "@/lib/reports";

// 지표용 이벤트. report_saved는 서버가 저장할 때 직접 센다.
const CLIENT_EVENTS = ["report_started", "map_viewed"] as const;

export async function POST(req: Request) {
  const body = (await readJson(req)) as { name?: unknown } | null;
  const name = CLIENT_EVENTS.find((e) => e === body?.name);
  if (!name) return error("알 수 없는 이벤트예요.");
  bumpEvent(getDb(), name);
  return json({ ok: true });
}
