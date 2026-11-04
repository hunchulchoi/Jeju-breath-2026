import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDb } from "./pg";
import { blockNameOf, buildSkillResponse, skillLogFields, checkSkillSecret, GUIDE_DESCRIPTION, GUIDE_TITLE, GUIDE_IMAGE_ALT, SKILL_TITLE, SKILL_DESCRIPTION } from "@/lib/kakao";

let db: Awaited<ReturnType<typeof testDb>>;
beforeAll(async () => {
  db = await testDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

describe("checkSkillSecret", () => {
  it("같을 때만 통과", () => {
    expect(checkSkillSecret("abc", "abc")).toBe(true);
    expect(checkSkillSecret("abd", "abc")).toBe(false);
    expect(checkSkillSecret("abcd", "abc")).toBe(false);
    expect(checkSkillSecret(null, "abc")).toBe(false);
    expect(checkSkillSecret("", "")).toBe(false);
    expect(checkSkillSecret("abc", undefined)).toBe(false);
  });
});

describe("스킬 응답", () => {
  it("textCard에 버튼 2개, label 14자 이내, 링크는 /report와 /map", () => {
    const res = buildSkillResponse("https://x.example/") as any;
    const card = res.template.outputs[0].textCard;
    expect(res.version).toBe("2.0");
    expect(card.title).toBe(SKILL_TITLE);
    expect(card.description).toBe(SKILL_DESCRIPTION);
    expect(card.description).toContain("[제보하러 가기]");
    // 카카오 textCard: 제목 50자 이하, 제목+설명 400자 이하
    expect([...card.title].length).toBeLessThanOrEqual(50);
    expect([...card.title].length + [...card.description].length).toBeLessThanOrEqual(400);
    expect(card.buttons.map((b: any) => b.webLinkUrl)).toEqual(["https://x.example/report", "https://x.example/map"]);
    for (const b of card.buttons) {
      expect(b.action).toBe("webLink");
      expect([...b.label].length).toBeLessThanOrEqual(14);
    }
  });
});

describe("POST /api/kakao/skill", () => {
  const mount = async () => {
    vi.resetModules();
    vi.stubEnv("KAKAO_SKILL_SECRET", "s3cret");
    vi.stubEnv("PUBLIC_BASE_URL", "https://x.example");
    // DB를 건드리면 바로 실패하도록 getDb를 막는다
    const getDb = vi.fn(() => Promise.reject(new Error("DB를 쓰면 안 돼요")));
    vi.doMock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb }));
    const { POST } = await import("@/app/api/kakao/skill/route");
    return { POST, getDb };
  };
  const call = (POST: (r: Request) => Promise<Response>, body: unknown, secret = "s3cret") =>
    POST(new Request("https://x.example/api/kakao/skill", {
      method: "POST",
      headers: { "x-skill-secret": secret, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }));

  it.each([
    { userRequest: { utterance: "축사 냄새 심해요 010-1234-5678", user: { id: "u1" } } },
    { userRequest: { utterance: "", user: { id: "u1" } } },
    { userRequest: { utterance: "가".repeat(900), user: { id: "u1" } } },
    {},
    "not json",
  ])("발화와 상관없이 링크 2개를 회신하고 DB에 쓰지 않는다 %#", async (body) => {
    const { POST, getDb } = await mount();
    const res = await call(POST, body);
    expect(res.status).toBe(200);
    const card = ((await res.json()) as any).template.outputs[0].textCard;
    expect(card.buttons.map((b: any) => b.webLinkUrl)).toEqual(["https://x.example/report", "https://x.example/map"]);
    expect(getDb).not.toHaveBeenCalled();
    for (const t of ["reports", "event_counts", "location_failures"]) {
      expect((await db.query(`SELECT 1 FROM ${t}`)).rows).toHaveLength(0);
    }
  });

  it("비밀 헤더가 틀리면 401", async () => {
    const { POST } = await mount();
    expect((await call(POST, {}, "wrong")).status).toBe(401);
  });
});

describe("블록별 문구", () => {
  const card = (r: ReturnType<typeof buildSkillResponse>) =>
    (r as { template: { outputs: { textCard: { title: string; description: string; buttons: unknown[] } }[] } }).template.outputs[0].textCard;
  it("이용 안내 블록이면 안내 문구, 그 밖에는 웰컴 문구. 버튼은 같다", () => {
    const out = (buildSkillResponse("https://x/", blockNameOf({ userRequest: { block: { name: "이용 안내" } } })) as {
      template: { outputs: { basicCard?: { title: string; description: string; thumbnail: { imageUrl: string; altText: string; fixedRatio: boolean }; buttons: { label: string; webLinkUrl: string }[] }; textCard?: unknown }[] };
    }).template.outputs[0];
    expect(out.textCard).toBeUndefined();
    const guide = out.basicCard!;
    expect(guide.title).toBe(GUIDE_TITLE);
    expect(guide.thumbnail).toEqual({ imageUrl: "https://x/brand/guide.png", altText: GUIDE_IMAGE_ALT, fixedRatio: true });
    expect(guide.buttons.map((b) => b.label)).toEqual(["제보하러 가기", "오늘 지도 보기"]);
    expect(guide.description.includes("\n")).toBe(false);
    // 카카오 basicCard(썸네일 있음): 제목+설명 230자 안쪽
    expect([...guide.title].length + [...guide.description].length).toBeLessThanOrEqual(230);
    expect(card(buildSkillResponse("https://x", blockNameOf({ userRequest: { block: { name: "악취 제보 시작" } } }))).title).toBe(SKILL_TITLE);
    expect(card(buildSkillResponse("https://x", blockNameOf({ userRequest: { block: { name: "폴백 블록" } } }))).title).toBe(SKILL_TITLE);
    expect(card(buildSkillResponse("https://x", blockNameOf(null))).description).toBe(SKILL_DESCRIPTION);
    expect(GUIDE_DESCRIPTION).toContain("200m");
  });
});

describe("skillLogFields", () => {
  it("블록 이름과 surface만 꺼내고 발화·사용자 정보는 넣지 않는다", () => {
    const body = { userRequest: { utterance: "010-1234-5678 냄새", user: { id: "user-key-123" }, block: { name: "이용 안내" }, params: { surface: "Kakaotalk.plusfriend" } } };
    const f = skillLogFields(body);
    expect(f).toEqual({ block: "이용 안내", surface: "Kakaotalk.plusfriend" });
    expect(JSON.stringify(f)).not.toContain("user-key-123");
    expect(JSON.stringify(f)).not.toContain("010");
    expect(skillLogFields(null)).toEqual({ block: "", surface: "" });
  });
});
