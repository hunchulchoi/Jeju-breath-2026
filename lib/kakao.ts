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
export function buildSkillResponse(baseUrl: string): SkillResponse {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          textCard: {
            title: "냄새 제보",
            description: "버튼을 누르면 위치와 냄새 세기만 골라 제보할 수 있어요.",
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
