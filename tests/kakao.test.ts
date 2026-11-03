import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDb } from "./pg";
import { hashUserId } from "@/lib/hash";
import {
  buildSkillResponse,
  checkSkillSecret,
  consumeDraft,
  createDraft,
  getDraft,
  parseSkillRequest,
} from "@/lib/kakao";
import { submitReport, type ReportInput } from "@/lib/reports";

let db: Awaited<ReturnType<typeof testDb>>;
beforeAll(async () => {
  db = await testDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

const AEWOL = { lat: 33.4625, lng: 126.3305 };
const t0 = new Date("2026-11-03T19:00:00+09:00");
const min = (n: number) => new Date(t0.getTime() + n * 60_000);
const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  text: "축사 냄새가 나요",
  ...AEWOL,
  accuracy: 20,
  intensity: 3,
  intensity_src: "button",
  odor_type: "양돈",
  symptoms: [],
  confidence: null,
  ...over,
});

describe("parseSkillRequest", () => {
  const ok = { userRequest: { utterance: "냄새나요", user: { id: "botkey123" } } };
  it("정상 요청", () => {
    expect(parseSkillRequest(ok)).toEqual({ utterance: "냄새나요", userKey: "botkey123" });
  });
  it.each([
    null,
    "x",
    {},
    { userRequest: {} },
    { userRequest: { utterance: 1, user: { id: "a" } } },
    { userRequest: { utterance: "a" } },
    { userRequest: { utterance: "a", user: { id: "" } } },
    { userRequest: { utterance: "a", user: { id: 5 } } },
  ])("비정상 요청 %j", (body) => {
    expect(parseSkillRequest(body)).toBeNull();
  });
});

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
  it("버튼 2개, label 14자 이내, 링크에는 token만", () => {
    const res = buildSkillResponse("010-1234-5678 냄새나요", "TOKENabcdefghijklmno", "https://x.example/") as any;
    const card = res.template.outputs[0].textCard;
    expect(res.version).toBe("2.0");
    expect(card.buttons).toHaveLength(2);
    for (const b of card.buttons) {
      expect(b.action).toBe("webLink");
      expect([...b.label].length).toBeLessThanOrEqual(14);
    }
    expect(card.buttons[0].webLinkUrl).toBe("https://x.example/report?d=TOKENabcdefghijklmno");
    expect(card.buttons[1].webLinkUrl).toBe("https://x.example/map");
    expect(card.buttons[0].webLinkUrl).not.toContain("냄새");
    expect(card.description).not.toContain("5678");
    expect(card.description.length).toBeLessThanOrEqual(230);
  });
  it("빈 문장과 긴 문장은 simpleText", () => {
    const empty = buildSkillResponse("  ", "t", "https://x") as any;
    expect(empty.template.outputs[0].simpleText.text).toBe("냄새를 한 문장으로 보내 주세요.");
    const long = buildSkillResponse("가".repeat(501), "t", "https://x") as any;
    expect(long.template.outputs[0].simpleText.text).toBe("500자 이내로 보내 주세요.");
  });
  it("500자 문장도 description은 230자 이내", () => {
    const res = buildSkillResponse("가".repeat(500), "T".repeat(22), "https://x") as any;
    expect([...res.template.outputs[0].textCard.description].length).toBeLessThanOrEqual(230);
  });
});

describe("초안", () => {
  it("전화번호를 가려 저장하고 원래 키는 어디에도 없다", async () => {
    const token = await createDraft(db, { userKey: "RAWKEY-abc123", text: "연락은 010-1234-5678로 주세요 냄새나요" }, t0);
    const rows = await db.query<Record<string, unknown>>("SELECT * FROM kakao_drafts");
    expect(rows.rows).toHaveLength(1);
    const dump = JSON.stringify(rows.rows);
    expect(dump).not.toContain("1234-5678");
    expect(dump).not.toContain("RAWKEY-abc123");
    expect(rows.rows[0].user_hash).toBe(hashUserId("kakao:RAWKEY-abc123"));
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("30분이 지나면 null, 29분은 유효", async () => {
    const token = await createDraft(db, { userKey: "k1", text: "냄새" }, t0);
    expect(await getDraft(db, token, min(29))).toMatchObject({ token, text: "냄새" });
    expect(await getDraft(db, token, min(31))).toBeNull();
  });

  it("형식이 틀린 token은 null", async () => {
    expect(await getDraft(db, "short", t0)).toBeNull();
    expect(await getDraft(db, "a'; DROP TABLE x;--aaaaaaaa", t0)).toBeNull();
    expect(await getDraft(db, 123, t0)).toBeNull();
  });

  it("하루 지난 초안은 다음 생성 때 지워진다", async () => {
    await createDraft(db, { userKey: "k1", text: "옛날" }, t0);
    await createDraft(db, { userKey: "k2", text: "지금" }, min(25 * 60));
    const { rows } = await db.query<{ text_masked: string }>("SELECT text_masked FROM kakao_drafts");
    expect(rows.map((r) => r.text_masked)).toEqual(["지금"]);
  });

  it("사용한 뒤에는 null", async () => {
    const token = await createDraft(db, { userKey: "k1", text: "냄새" }, t0);
    expect(await consumeDraft(db, token, min(1))).toBe(true);
    expect(await getDraft(db, token, min(2))).toBeNull();
    expect(await consumeDraft(db, token, min(2))).toBe(false);
  });
});

describe("submitReport + consumeDraftToken", () => {
  it("성공하면 소비하고, 두 번째는 draft_used (제보 추가 없음)", async () => {
    const token = await createDraft(db, { userKey: "k1", text: "냄새" }, t0);
    const draft = (await getDraft(db, token, min(1)))!;
    const a = await submitReport(db, input({ user_hash: draft.user_hash, text: draft.text }), min(2), {
      consumeDraftToken: token,
    });
    expect(a.ok).toBe(true);
    const b = await submitReport(db, input({ user_hash: draft.user_hash, text: draft.text }), min(3), {
      consumeDraftToken: token,
    });
    expect(b).toEqual({ ok: false, problem: "draft_used" });
    const { rows } = await db.query<{ merged_count: number }>("SELECT merged_count FROM reports");
    expect(rows).toHaveLength(1);
    expect(rows[0].merged_count).toBe(1);
    expect(await getDraft(db, token, min(3))).toBeNull();
  });

  it("위치 실패면 소비하지 않아 다시 시도할 수 있다", async () => {
    const token = await createDraft(db, { userKey: "k1", text: "냄새" }, t0);
    const draft = (await getDraft(db, token, min(1)))!;
    const bad = await submitReport(db, input({ user_hash: draft.user_hash, lat: 37.5, lng: 127 }), min(2), {
      consumeDraftToken: token,
    });
    expect(bad).toEqual({ ok: false, problem: "out_of_bounds" });
    expect(await getDraft(db, token, min(3))).not.toBeNull();
    const ok = await submitReport(db, input({ user_hash: draft.user_hash }), min(4), { consumeDraftToken: token });
    expect(ok.ok).toBe(true);
  });

  it("만료된 초안은 소비되지 않고 제보도 저장되지 않는다", async () => {
    const token = await createDraft(db, { userKey: "k1", text: "냄새" }, t0);
    const r = await submitReport(db, input({ user_hash: hashUserId("kakao:k1") }), min(31), {
      consumeDraftToken: token,
    });
    expect(r).toEqual({ ok: false, problem: "draft_used" });
    expect((await db.query("SELECT 1 FROM reports")).rows).toHaveLength(0);
  });

  it("user_hash는 hashUserId('kakao:'+key)이고 같은 사용자의 두 제보는 병합된다", async () => {
    const t1 = await createDraft(db, { userKey: "k1", text: "냄새 하나" }, t0);
    const t2 = await createDraft(db, { userKey: "k1", text: "냄새 둘" }, t0);
    for (const [i, t] of [t1, t2].entries()) {
      const d = (await getDraft(db, t, min(1)))!;
      const r = await submitReport(db, input({ user_hash: d.user_hash, text: d.text }), min(2 + i * 10), {
        consumeDraftToken: t,
      });
      expect(r.ok).toBe(true);
      if (i === 1 && r.ok) expect(r.merged).toBe(true);
    }
    const { rows } = await db.query<{ user_hash: string; merged_count: number }>("SELECT user_hash, merged_count FROM reports");
    expect(rows).toHaveLength(1);
    expect(rows[0].user_hash).toBe(hashUserId("kakao:k1"));
    expect(rows[0].merged_count).toBe(2);
  });
});
