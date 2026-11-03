import Anthropic from "@anthropic-ai/sdk";
import { CONFIDENCE_THRESHOLD, ODOR_TYPES, isOdorType, type Extraction } from "./types";

export const MODEL = "claude-haiku-5-5";
const TOOL_NAME = "record_odor_report";
const TIMEOUT_MS = 5_000;

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "주민의 악취 제보 문장에서 강도, 냄새 종류, 증상, 확신도를 기록한다.",
  input_schema: {
    type: "object",
    properties: {
      intensity: {
        type: ["integer", "null"],
        minimum: 1,
        maximum: 5,
        description: "강도 1-5. 문장에 강도를 판단할 표현이 없으면 null",
      },
      odor_type: { type: "string", enum: [...ODOR_TYPES] },
      symptoms: {
        type: "array",
        items: { type: "string" },
        description: "문장에 나온 증상이나 행동 (예: 창문 닫음, 두통, 숨 막힘). 없으면 빈 배열",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "intensity 판단에 대한 확신도 0-1",
      },
    },
    required: ["intensity", "odor_type", "symptoms", "confidence"],
  },
};

// few-shot 예시 5개 (PRD 6.4에서 선택)
const SYSTEM_PROMPT = `너는 제주 주민의 악취 제보 문장을 구조화한다. 항상 ${TOOL_NAME} 도구로 결과를 기록한다.

## 강도 기준 (제주 주민참여형 악취모니터링 0-5도 준용, 0 무취는 제보 대상 아님)
1 감지 취기: 살짝 냄새나요
2 보통 취기: 무슨 냄새인지 알겠어요
3 강한 취기: 냄새가 확 나요
4 극심한 취기: 창문 닫아야 해요
5 참기 어려운 취기: 숨쉬기 힘들어요

## 규칙
- 강도는 위 기준에 맞춰 판단한다. 창문을 닫는 등 생활에 지장이 있으면 4, 숨쉬기 어렵거나 몸에 이상이 있으면 5다.
- 문장에 강도를 판단할 표현이 없으면 intensity는 null, confidence는 0으로 둔다.
- 사투리·과장 표현은 뜻을 헤아려 판단하되, 애매하면 confidence를 낮춘다.
- 냄새 종류: 돼지·축사(돼지 언급)는 양돈, 닭은 계사, 소는 우사, 거름·퇴비는 퇴비, 분뇨 살포·액비는 액비, 음식물 쓰레기는 음식물. 축사라고만 하면 양돈으로 추정할 수 있으나 confidence에는 영향을 주지 않는다. 단서가 없으면 알 수 없음.
- 원인이나 책임 사업장을 추정하지 않는다. 문장에 없는 내용을 지어내지 않는다.

## 예시
"살짝 냄새가 나네요" → intensity 1, odor_type 알 수 없음, symptoms [], confidence 0.8
"돼지 냄새인 걸 알겠어요" → intensity 2, odor_type 양돈, symptoms [], confidence 0.85
"축사 냄새 때문에 창문을 못 열겠어요" → intensity 4, odor_type 양돈, symptoms ["창문 닫음"], confidence 0.8
"숨을 못 쉬겠어요" → intensity 5, odor_type 알 수 없음, symptoms ["숨 막힘"], confidence 0.8
"냄새가 납니다" → intensity null, odor_type 알 수 없음, symptoms [], confidence 0`;

/** 도구 입력이 스키마에 맞는지 직접 확인한다. 맞지 않으면 null. */
export function parseExtraction(input: unknown): Extraction | null {
  if (typeof input !== "object" || input === null) return null;
  const v = input as Record<string, unknown>;
  const { intensity, odor_type, symptoms, confidence } = v;
  const intensityOk =
    intensity === null ||
    (typeof intensity === "number" && Number.isInteger(intensity) && intensity >= 1 && intensity <= 5);
  if (!intensityOk) return null;
  if (!isOdorType(odor_type)) return null;
  if (!Array.isArray(symptoms) || !symptoms.every((s) => typeof s === "string")) return null;
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) return null;
  return {
    intensity: intensity as number | null,
    odor_type,
    symptoms: (symptoms as string[]).map((s) => s.trim()).filter(Boolean).slice(0, 5),
    confidence,
  };
}

export function needsQuestion(e: Pick<Extraction, "intensity" | "confidence">): boolean {
  return e.intensity === null || e.confidence < CONFIDENCE_THRESHOLD;
}

export type ExtractResult = Extraction & {
  needs_question: boolean;
  /** ai: Claude 결과 / fallback: 실패해서 버튼 질문으로 전환 */
  source: "ai" | "fallback";
};

const FALLBACK: ExtractResult = {
  intensity: null,
  odor_type: "알 수 없음",
  symptoms: [],
  confidence: 0,
  needs_question: true,
  source: "fallback",
};

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 });
  return client;
}

async function callOnce(c: Anthropic, text: string): Promise<Extraction | null> {
  const response = await c.messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { effort: "low" },
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: `제보 문장: ${text}` }],
  });
  if (response.stop_reason === "refusal") throw new RefusalError();
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME,
  );
  return block ? parseExtraction(block.input) : null;
}

class RefusalError extends Error {}

/**
 * 제보 문장에서 강도·냄새 종류·증상·확신도를 뽑는다.
 * 형식이 틀리면 1회 재시도, API 오류·5초 초과·거절·키 없음이면 바로 버튼 질문으로 넘긴다.
 */
export async function extractOdor(text: string, c: Anthropic | null = getClient()): Promise<ExtractResult> {
  if (!c) return FALLBACK;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await callOnce(c, text);
      if (result) return { ...result, needs_question: needsQuestion(result), source: "ai" };
    }
    return FALLBACK;
  } catch (err) {
    if (err instanceof RefusalError || err instanceof Anthropic.APIError) {
      // 원문은 로그에 남기지 않는다 (PRD 11장)
      console.warn("[extract] fallback:", err instanceof Anthropic.APIError ? err.status ?? err.name : "refusal");
      return FALLBACK;
    }
    throw err;
  }
}
