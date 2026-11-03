import { getDb } from "@/lib/db";
import { error, json } from "@/lib/http";
import { buildSkillResponse, checkSkillSecret, createDraft, parseSkillRequest } from "@/lib/kakao";
import { MAX_TEXT_LENGTH, bumpEvent } from "@/lib/reports";

/**
 * 카카오 오픈빌더 스킬. 5초 제한 때문에 AI는 부르지 않고, 문장을 마스킹해 초안으로 저장한 뒤
 * [위치 확인하고 제보하기] 링크 카드로 회신한다. 로그에 발화·사용자 키를 남기지 않는다.
 */
export async function POST(req: Request) {
  const secret = process.env.KAKAO_SKILL_SECRET;
  if (!secret) return error("서버 설정이 빠져 있어요.", 503);
  if (!checkSkillSecret(req.headers.get("x-skill-secret"), secret)) return error("권한이 없어요.", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = parseSkillRequest(body);
  if (!parsed) return error("잘못된 요청이에요.", 400);

  const base = (process.env.PUBLIC_BASE_URL || new URL(req.url).origin).replace(/\/+$/, "");
  const text = parsed.utterance.trim();
  // 비었거나 너무 길면 초안을 만들지 않고 안내만 한다
  if (text === "" || text.length > MAX_TEXT_LENGTH) return json(buildSkillResponse(parsed.utterance, "", base));

  const db = await getDb();
  const token = await createDraft(db, { userKey: parsed.userKey, text });
  try {
    await bumpEvent(db, "report_started");
  } catch (e) {
    console.error("[metrics] 이벤트 기록 실패", (e as Error).name);
  }
  return json(buildSkillResponse(parsed.utterance, token, base));
}
