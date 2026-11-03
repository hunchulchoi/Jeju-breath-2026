import { getDb } from "@/lib/db";
import { json } from "@/lib/http";
import { recordLocationFailure } from "@/lib/reports";

// 본문을 받지 않는다. 날짜별 횟수만 +1 (내용·좌표·식별자 없음)
export async function POST() {
  recordLocationFailure(getDb());
  return json({ ok: true });
}
