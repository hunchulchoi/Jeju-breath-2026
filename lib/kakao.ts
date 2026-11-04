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

/**
 * 임시 진단: 카카오톡에서 위치·사진을 보낼 때 스킬 요청에 어떤 모양으로 오는지 확인한다.
 * 키 이름과 발화의 '종류'만 남긴다 (발화 내용·좌표·주소·사용자 키는 남기지 않는다).
 */
export function skillShape(body: unknown): Record<string, unknown> {
  try {
    return shapeOf(body);
  } catch {
    return { error: true };
  }
}

/** 오픈빌더가 정하는 식별자 모양의 키만 이름을 남기고, 나머지(사용자 값일 수 있음)는 개수만 센다 */
function safeKeys(v: unknown): { keys: string[]; other: number } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { keys: [], other: 0 };
  const all = Object.keys(v);
  const keys = all.filter((k) => /^[A-Za-z_][A-Za-z0-9_]{0,30}$/.test(k)).slice(0, 20);
  return { keys, other: all.length - keys.length };
}

/** URL 호스트는 사용자 입력이라 그대로 남기지 않고 고정 분류로 바꾼다 */
function hostKind(u: string): string {
  const m = u.match(/https?:\/\/([A-Za-z0-9.-]+)/);
  if (!m) return "";
  const h = m[1].toLowerCase();
  for (const [kind, re] of [
    ["kakaomap", /(^|\.)map\.kakao\.com$|(^|\.)kko\.to$/],
    ["kakaocdn", /(^|\.)(kakaocdn|daumcdn)\.net$/],
    ["kakao", /(^|\.)kakao\.com$/],
    ["naver", /(^|\.)naver\.(com|me)$/],
    ["google", /(^|\.)(google\.com|goo\.gl)$/],
  ] as const) {
    if (re.test(h)) return kind;
  }
  return "other";
}

function shapeOf(body: unknown): Record<string, unknown> {
  const b = (body ?? {}) as {
    userRequest?: { utterance?: unknown; params?: unknown };
    action?: { params?: unknown; detailParams?: unknown; clientExtra?: unknown };
  };
  const u = b.userRequest?.utterance;
  const utter =
    typeof u === "string"
      ? {
          type: "string",
          len: u.length,
          host: hostKind(u),
          coordLike: /\b3[2-4]\.\d{3,}.{0,5}12[5-7]\.\d{3,}|\b12[5-7]\.\d{3,}.{0,5}3[2-4]\.\d{3,}/.test(u),
          lines: u.split("\n").length,
        }
      : { type: typeof u };
  return {
    top: safeKeys(body),
    userRequest: safeKeys(b.userRequest),
    urParams: safeKeys(b.userRequest?.params),
    actionParams: safeKeys(b.action?.params),
    detailParams: safeKeys(b.action?.detailParams),
    clientExtra: safeKeys(b.action?.clientExtra),
    utter,
  };
}

/** 이용 안내 basicCard의 썸네일 (800×800, scripts/make-guide-image.mjs로 생성). 6개 항목은 GUIDE_DESCRIPTION과 같은 내용 */
export const GUIDE_IMAGE_PATH = "/brand/guide.png";
export const GUIDE_IMAGE_ALT = "제주숨결봇 이용 안내";
/** basicCard 설명은 한 줄만 (자세한 내용은 이미지) */
export const GUIDE_CARD_DESCRIPTION = "위치와 냄새 세기만 고르면 제보돼요.";

export function buildSkillResponse(baseUrl: string, blockName = ""): SkillResponse {
  const guide = blockName.includes("안내");
  const base = baseUrl.replace(/\/+$/, "");
  const buttons = [
    { label: "제보하러 가기", action: "webLink", webLinkUrl: `${base}/report` },
    { label: "오늘 지도 보기", action: "webLink", webLinkUrl: `${base}/map` },
  ];
  if (guide) {
    // 이용 안내: 6개 항목을 큰 글씨 이미지로 보여 주는 basicCard (1:1 이미지라 fixedRatio)
    return {
      version: "2.0",
      template: {
        outputs: [
          {
            basicCard: {
              title: GUIDE_TITLE,
              description: GUIDE_CARD_DESCRIPTION,
              thumbnail: { imageUrl: `${base}${GUIDE_IMAGE_PATH}`, altText: GUIDE_IMAGE_ALT, fixedRatio: true },
              buttons,
            },
          },
        ],
      },
    };
  }
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          textCard: {
            title: SKILL_TITLE,
            description: SKILL_DESCRIPTION,
            buttons,
          },
        },
      ],
    },
  };
}
