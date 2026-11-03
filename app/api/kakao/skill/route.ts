import { error, json } from "@/lib/http";
import { blockNameOf, buildSkillResponse, checkSkillSecret } from "@/lib/kakao";

/**
 * 카카오 오픈빌더 스킬. 발화와 사용자 키는 읽지도 저장하지도 않고,
 * [제보하러 가기]·[오늘 지도 보기] 링크 카드로 회신한다. DB도 쓰지 않는다.
 * 블록 이름에 "안내"가 들어가면(이용 안내 블록) 이용 안내 문구를, 그 밖에는 웰컴 문구를 보낸다.
 */
export async function POST(req: Request) {
  const secret = process.env.KAKAO_SKILL_SECRET;
  if (!secret) return error("서버 설정이 빠져 있어요.", 503);
  if (!checkSkillSecret(req.headers.get("x-skill-secret"), secret)) return error("권한이 없어요.", 401);

  const base = (process.env.PUBLIC_BASE_URL || new URL(req.url).origin).replace(/\/+$/, "");
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  return json(buildSkillResponse(base, blockNameOf(body)));
}
