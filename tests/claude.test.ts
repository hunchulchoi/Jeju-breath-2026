import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { extractOdor, needsQuestion, parseExtraction } from "@/lib/claude";

const good = { intensity: 4, odor_type: "양돈", symptoms: ["창문 닫음"], confidence: 0.8 };

/** messages.create만 흉내 내는 가짜 클라이언트 */
function fakeClient(responses: Array<unknown | Error>) {
  const create = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}
const toolResponse = (input: unknown) => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: "t1", name: "record_odor_report", input }],
});

describe("스키마 검사", () => {
  it("정상 값", () => expect(parseExtraction(good)).toEqual(good));
  it("intensity null 허용", () => expect(parseExtraction({ ...good, intensity: null })?.intensity).toBeNull());
  it("범위 밖 강도·모르는 종류·확신도 거절", () => {
    expect(parseExtraction({ ...good, intensity: 6 })).toBeNull();
    expect(parseExtraction({ ...good, intensity: 3.5 })).toBeNull();
    expect(parseExtraction({ ...good, odor_type: "공장" })).toBeNull();
    expect(parseExtraction({ ...good, confidence: 1.2 })).toBeNull();
  });
});

describe("FR-4 질문 조건", () => {
  it("강도 없음 또는 확신도 0.7 미만이면 질문", () => {
    expect(needsQuestion({ intensity: null, confidence: 0.9 })).toBe(true);
    expect(needsQuestion({ intensity: 3, confidence: 0.69 })).toBe(true);
    expect(needsQuestion({ intensity: 3, confidence: 0.7 })).toBe(false);
  });
});

describe("extractOdor 실패 처리", () => {
  it("키가 없으면 버튼 질문", async () => {
    expect(await extractOdor("냄새", null)).toMatchObject({ needs_question: true, source: "fallback" });
  });

  it("정상 응답", async () => {
    const { client } = fakeClient([toolResponse(good)]);
    expect(await extractOdor("축사 냄새", client)).toMatchObject({ ...good, needs_question: false, source: "ai" });
  });

  it("형식이 틀리면 1회 재시도", async () => {
    const { client, create } = fakeClient([toolResponse({ ...good, intensity: 9 }), toolResponse(good)]);
    expect(await extractOdor("축사 냄새", client)).toMatchObject({ intensity: 4, source: "ai" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("두 번 다 틀리면 버튼 질문", async () => {
    const { client, create } = fakeClient([toolResponse({}), toolResponse({})]);
    expect(await extractOdor("축사 냄새", client)).toMatchObject({ source: "fallback", needs_question: true });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("API 오류·시간 초과면 재시도 없이 버튼 질문", async () => {
    const { client, create } = fakeClient([new Anthropic.APIConnectionTimeoutError()]);
    expect(await extractOdor("축사 냄새", client)).toMatchObject({ source: "fallback", odor_type: "알 수 없음" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("안전 분류기 거절이면 버튼 질문", async () => {
    const { client } = fakeClient([{ stop_reason: "refusal", content: [] }]);
    expect(await extractOdor("축사 냄새", client)).toMatchObject({ source: "fallback" });
  });
});
