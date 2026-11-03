import { getDb } from "@/lib/db";
import { getDraft } from "@/lib/kakao";
import { dayParam, error, json, readBodyLimited } from "@/lib/http";
import { PHOTO_RULES, attachPhoto, type PhotoResult } from "@/lib/photos";
import { listReports, parseReportBody, submitReport } from "@/lib/reports";
import { getStore } from "@/lib/storage";

const PROBLEM_MESSAGES = {
  missing: "위치를 확인하지 못해 저장하지 않았어요.",
  out_of_bounds: "제주도 밖 위치라 저장하지 않았어요.",
  low_accuracy: "위치가 정확하지 않아 저장하지 않았어요.",
} as const;

const DRAFT_EXPIRED = "링크가 만료됐어요. 카카오톡에서 다시 보내 주세요.";

// 사진(최대 10MB)과 본문을 합친 요청 상한
const MAX_REQUEST_BYTES = PHOTO_RULES.maxUploadBytes + 64 * 1024;

export async function GET(req: Request) {
  const day = dayParam(req);
  if (!day) return error("date는 YYYY-MM-DD 형식이어야 해요.");
  return json({ date: day, reports: await listReports(await getDb(), day) });
}

/**
 * JSON 본문, 또는 사진을 붙일 때는 multipart/form-data (data: JSON 문자열, photo: 이미지 파일).
 * 사진이 실패해도 제보는 저장하고 photo 필드로 결과를 알려 준다.
 */
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) {
    return error("사진은 10MB 이하만 올릴 수 있어요.", 413);
  }

  const bytes = await readBodyLimited(req, MAX_REQUEST_BYTES);
  if (!bytes) return error("사진은 10MB 이하만 올릴 수 있어요.", 413);

  let body: unknown;
  let photo: File | null = null;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await new Response(bytes as BodyInit, { headers: { "content-type": contentType } }).formData();
    } catch {
      return error("잘못된 요청이에요.");
    }
    try {
      body = JSON.parse(String(form.get("data") ?? ""));
    } catch {
      body = null;
    }
    const file = form.get("photo");
    if (file instanceof File && file.size > 0) photo = file;
  } else {
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      body = null;
    }
  }

  const parsed = parseReportBody(body);
  if (!parsed.ok) return error(parsed.error, parsed.status);
  const db = await getDb();
  let input = parsed.input;
  let consumeDraftToken: string | undefined;
  if (input.draft_token) {
    const draft = await getDraft(db, input.draft_token);
    if (!draft) return error(DRAFT_EXPIRED, 410);
    // 제보자와 문장은 초안 값만 쓴다
    input = { ...input, user_id: undefined, user_hash: draft.user_hash, text: draft.text };
    consumeDraftToken = draft.token;
  }
  const result = await submitReport(db, input, undefined, { consumeDraftToken });
  if (!result.ok && result.problem === "draft_used") return error(DRAFT_EXPIRED, 410);
  if (!result.ok) {
    return json({ error: PROBLEM_MESSAGES[result.problem], problem: result.problem }, 422);
  }

  let photoResult: PhotoResult | null = null;
  if (photo) {
    if (photo.size > PHOTO_RULES.maxUploadBytes) {
      photoResult = "too_large";
    } else {
      try {
        photoResult = await attachPhoto(db, getStore(), result.id, Buffer.from(await photo.arrayBuffer()));
      } catch (e) {
        console.error("[photo] 처리 실패", (e as Error).name);
        photoResult = "failed";
      }
    }
  }

  const { ok: _ok, ...rest } = result;
  return json({ ...rest, photo: photoResult }, 201);
}
