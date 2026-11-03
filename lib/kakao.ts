import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Queryable } from "./db";
import { hashUserId } from "./hash";
import { maskPersonalInfo } from "./mask";
import { MAX_TEXT_LENGTH } from "./reports";

export const DRAFT_TTL_MS = 30 * 60_000;
const DRAFT_CLEANUP_MS = 24 * 60 * 60_000;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const DESCRIPTION_MAX = 230;

export function isDraftToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN_RE.test(v);
}

/** 오픈빌더 스킬 요청에서 발화와 사용자 키를 꺼낸다. 형식이 다르면 null */
export function parseSkillRequest(body: unknown): { utterance: string; userKey: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const ur = (body as Record<string, unknown>).userRequest;
  if (typeof ur !== "object" || ur === null) return null;
  const r = ur as Record<string, unknown>;
  if (typeof r.utterance !== "string") return null;
  const user = r.user;
  if (typeof user !== "object" || user === null) return null;
  const id = (user as Record<string, unknown>).id;
  if (typeof id !== "string" || id.trim() === "") return null;
  return { utterance: r.utterance, userKey: id };
}

/** x-skill-secret 헤더 검사. 길이가 다르거나 비어 있으면 false */
export function checkSkillSecret(header: string | null | undefined, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function kakaoUserHash(userKey: string): string {
  return hashUserId("kakao:" + userKey);
}

/** 문장을 마스킹해 1회용 초안으로 저장하고 token을 돌려준다. 하루 지난 초안은 지운다. */
export async function createDraft(
  db: Queryable,
  { userKey, text }: { userKey: string; text: string },
  now = new Date(),
): Promise<string> {
  await db.query(`DELETE FROM kakao_drafts WHERE created_at < $1`, [new Date(now.getTime() - DRAFT_CLEANUP_MS)]);
  const token = randomBytes(16).toString("base64url");
  await db.query(
    `INSERT INTO kakao_drafts (token, user_hash, text_masked, created_at) VALUES ($1, $2, $3, $4)`,
    [token, kakaoUserHash(userKey), maskPersonalInfo(text.trim()), now],
  );
  return token;
}

/** 30분 안이고 아직 쓰지 않은 초안이면 돌려준다 */
export async function getDraft(
  db: Queryable,
  token: unknown,
  now = new Date(),
): Promise<{ token: string; text: string; user_hash: string } | null> {
  if (!isDraftToken(token)) return null;
  const { rows } = await db.query<{ token: string; text_masked: string; user_hash: string }>(
    `SELECT token, text_masked, user_hash FROM kakao_drafts
     WHERE token = $1 AND used_at IS NULL AND created_at >= $2`,
    [token, new Date(now.getTime() - DRAFT_TTL_MS)],
  );
  if (rows.length === 0) return null;
  return { token: rows[0].token, text: rows[0].text_masked, user_hash: rows[0].user_hash };
}

/** 저장 트랜잭션 안에서 부른다. 이미 썼거나 만료됐으면 false */
export async function consumeDraft(q: Queryable, token: string, now: Date): Promise<boolean> {
  const { rows } = await q.query<{ token: string }>(
    `UPDATE kakao_drafts SET used_at = $2
     WHERE token = $1 AND used_at IS NULL AND created_at >= $3
     RETURNING token`,
    [token, now, new Date(now.getTime() - DRAFT_TTL_MS)],
  );
  return rows.length > 0;
}

export type SkillResponse = Record<string, unknown>;

export function simpleText(text: string): SkillResponse {
  return { version: "2.0", template: { outputs: [{ simpleText: { text } }] } };
}

function clip(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max - 1).join("") + "…";
}

/** 스킬 응답 (형식 2.0). 문장이 비었거나 길면 안내 문구만 보낸다. */
export function buildSkillResponse(utterance: string, token: string, baseUrl: string): SkillResponse {
  const text = utterance.trim();
  if (text === "") return simpleText("냄새를 한 문장으로 보내 주세요.");
  if (text.length > MAX_TEXT_LENGTH) return simpleText(`${MAX_TEXT_LENGTH}자 이내로 보내 주세요.`);
  const base = baseUrl.replace(/\/+$/, "");
  const tail = "\n\n아래 버튼을 눌러 현재 위치를 확인하면 접수돼요. 링크는 30분 동안 쓸 수 있어요.";
  const quoted = clip(`"${maskPersonalInfo(text)}"`, DESCRIPTION_MAX - [...tail].length);
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          textCard: {
            title: "제보를 받았어요",
            description: quoted + tail,
            buttons: [
              {
                label: "위치 확인하고 제보하기",
                action: "webLink",
                webLinkUrl: `${base}/report?d=${encodeURIComponent(token)}`,
              },
              { label: "오늘 지도 보기", action: "webLink", webLinkUrl: `${base}/map` },
            ],
          },
        },
      ],
    },
  };
}
