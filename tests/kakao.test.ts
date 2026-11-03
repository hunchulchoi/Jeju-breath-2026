import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDb } from "./pg";
import { buildSkillResponse, checkSkillSecret, SKILL_TITLE, SKILL_DESCRIPTION } from "@/lib/kakao";

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
