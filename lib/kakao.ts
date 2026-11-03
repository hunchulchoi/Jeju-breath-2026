import { timingSafeEqual } from "node:crypto";

/** x-skill-secret 헤더 검사. 길이가 다르거나 비어 있으면 false */
export function checkSkillSecret(header: string | null | undefined, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SkillResponse = Record<string, unknown>;

/**
 * 스킬 응답 (형식 2.0). 발화 내용과 상관없이 같은 카드를 보낸다.
 * 제보는 웹에서 위치와 냄새 세기를 골라 접수하므로 문장은 받지 않는다.
 */
/** 웰컴·폴백 블록이 함께 쓰는 안내 문구. textCard는 제목+설명 합계 400자 안쪽으로 둔다. */
export const SKILL_TITLE = "냄새 때문에 불편하셨나요?";
export const SKILL_DESCRIPTION = [
  "지금 있는 곳의 냄새를 버튼 몇 번으로 지도에 남길 수 있어요.",
  "",
  "1. 아래 [제보하러 가기]를 눌러요",
  "2. 위치 확인을 허용해요",
  "3. 냄새 세기(1~5)를 고르면 끝이에요",
  "",
  "모인 제보는 날짜별 지도에서 누구나 볼 수 있어요. 냄새의 원인이나 책임을 판단하지는 않아요.",
].join("\n");

export const GUIDE_TITLE = "이용 안내";
export const GUIDE_DESCRIPTION = [
  "· 위치와 냄새 세기(1~5)만 골라 제보해요. 문장은 적지 않아도 돼요.",
  "· 위치는 약 200m 단위로 바꿔 지도에 보여요. 정확한 좌표는 판정 직후 지워요.",
  "· 30분 안에 같은 곳에서 다시 보내면 1건으로 합쳐져요.",
  "· 지도에서 내 근처(1km) 제보를 누르면 [저도 악취를 느꼈어요]로 바로 보탤 수 있어요.",
  "· 대기질 측정소 정보도 지도에서 함께 볼 수 있어요.",
  "· 원인이나 책임을 판단하지 않아요. 건강에 이상이 있으면 119나 의료기관에 문의하세요.",
].join("\n");

/** 오픈빌더 블록 이름(또는 인텐트 이름). 블록에 따라 문구만 바꾼다. 발화·사용자 정보는 읽지 않는다. */
export function blockNameOf(body: unknown): string {
  const b = (body ?? {}) as { userRequest?: { block?: { name?: unknown } }; intent?: { name?: unknown } };
  const name = b.userRequest?.block?.name ?? b.intent?.name;
  return typeof name === "string" ? name : "";
}

/**
 * 운영 확인용 로그 항목. 블록 이름과 요청 경로(surface: 카카오톡 채널인지 오픈빌더 봇테스트인지)만 남긴다.
 * 발화, 사용자 키, 기타 사용자 정보는 넣지 않는다.
 */
export function skillLogFields(body: unknown): { block: string; surface: string } {
  const b = (body ?? {}) as { userRequest?: { params?: { surface?: unknown } } };
  const surface = b.userRequest?.params?.surface;
  return { block: blockNameOf(body).slice(0, 40), surface: typeof surface === "string" ? surface.slice(0, 40) : "" };
}

export function buildSkillResponse(baseUrl: string, blockName = ""): SkillResponse {
  const guide = blockName.includes("안내");
  const base = baseUrl.replace(/\/+$/, "");
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          textCard: {
            title: guide ? GUIDE_TITLE : SKILL_TITLE,
            description: guide ? GUIDE_DESCRIPTION : SKILL_DESCRIPTION,
            buttons: [
              { label: "제보하러 가기", action: "webLink", webLinkUrl: `${base}/report` },
              { label: "오늘 지도 보기", action: "webLink", webLinkUrl: `${base}/map` },
            ],
          },
        },
      ],
    },
  };
}
