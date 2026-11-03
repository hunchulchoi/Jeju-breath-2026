// AI 강도 정확도 평가 (PRD 6.4, 12장). 실행: npm run eval [-- --split tune|eval|all]
// 기준: 평가용 20문장 중 강도 일치 18개 이상. 강도 없음(null) 문장은 반드시 버튼 질문으로 처리돼야 일치로 본다.
import fs from "node:fs";
import path from "node:path";
import { MODEL, extractOdor } from "../lib/claude";

interface Sentence {
  text: string;
  intensity: number | null;
  odor_type: string;
  split: "tune" | "eval";
}

const splitArg = process.argv.includes("--split") ? process.argv[process.argv.indexOf("--split") + 1] : "eval";
const file = path.join(process.cwd(), "eval", "sentences.json");
const { sentences } = JSON.parse(fs.readFileSync(file, "utf-8")) as { sentences: Sentence[] };
const target = splitArg === "all" ? sentences : sentences.filter((s) => s.split === splitArg);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY가 없어 평가할 수 없어요. .env.local 또는 환경변수에 넣어 주세요.");
  process.exit(1);
}

let intensityHits = 0;
let odorHits = 0;
let fallbacks = 0;
const misses: string[] = [];

for (const s of target) {
  const r = await extractOdor(s.text);
  if (r.source === "fallback") fallbacks++;
  // 버튼 질문으로 넘어가면 최종 강도는 사람이 고르므로, null 라벨은 질문이 나오면 일치
  const hit = s.intensity === null ? r.needs_question : !r.needs_question && r.intensity === s.intensity;
  if (hit) intensityHits++;
  else misses.push(`  ✗ "${s.text}" 라벨 ${s.intensity ?? "질문"} → AI ${r.intensity ?? "null"} (확신도 ${r.confidence})${r.needs_question ? " → 질문" : ""}`);
  if (r.odor_type === s.odor_type) odorHits++;
}

const n = target.length;
const passLine = Math.ceil(n * 0.9);
console.log(`모델 ${MODEL} · ${splitArg} ${n}문장`);
console.log(`강도 일치 ${intensityHits}/${n} (기준 ${passLine}개 이상) ${intensityHits >= passLine ? "통과" : "미달"}`);
console.log(`냄새 종류 일치 ${odorHits}/${n} · API 실패로 버튼 전환 ${fallbacks}건`);
if (misses.length) console.log(`불일치:\n${misses.join("\n")}`);
process.exit(intensityHits >= passLine ? 0 : 1);
