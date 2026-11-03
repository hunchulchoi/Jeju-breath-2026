// 시연용 가상 제보 20건 (PRD FR-8). 실행: npm run seed [-- YYYY-MM-DD]
// 같은 날 애월읍 한 마을에 아침(06~09시)·저녁(19~23시) 몰린 급증 상황. 다시 실행하면 그 날짜의 시연 데이터를 지우고 새로 넣는다.
import { openDb } from "../lib/db";
import { hashUserId } from "../lib/hash";
import { toGrid } from "../lib/rules";
import { dayRange, isValidDay, seoulDay } from "../lib/time";
import { CONSENT_VERSION, type OdorType } from "../lib/types";

// 애월읍 중산간 마을 (가상 기준점)
const VILLAGE = { lat: 33.4255, lng: 126.3355 };
// 비교용으로 떨어진 해안 마을
const COAST = { lat: 33.4635, lng: 126.3105 };

type Seed = [time: string, base: "v" | "c", dLat: number, dLng: number, intensity: number, odor: OdorType, symptoms: string[]];

const SEEDS: Seed[] = [
  // 아침 급증
  ["06:12", "v", 0.0, 0.0, 4, "양돈", ["창문 닫음"]],
  ["06:25", "v", 0.002, 0.001, 5, "양돈", ["숨 막힘"]],
  ["06:40", "v", -0.0015, 0.002, 4, "양돈", ["창문 닫음"]],
  ["07:05", "v", 0.001, -0.002, 3, "양돈", []],
  ["07:18", "v", 0.003, 0.0025, 5, "액비", ["두통"]],
  ["07:42", "v", -0.002, -0.001, 4, "양돈", ["빨래 못 널음"]],
  ["08:10", "v", 0.0005, 0.003, 4, "양돈", ["창문 닫음"]],
  ["08:35", "c", 0.001, 0.0, 2, "알 수 없음", []],
  ["08:55", "v", -0.003, 0.0015, 3, "퇴비", []],
  // 낮 (조용함)
  ["13:20", "c", -0.002, 0.002, 1, "알 수 없음", []],
  // 저녁 급증
  ["19:05", "v", 0.0015, -0.0005, 4, "양돈", ["창문 닫음"]],
  ["19:30", "v", -0.001, 0.0005, 5, "양돈", ["숨 막힘", "구역질"]],
  ["19:48", "v", 0.0025, -0.0015, 4, "양돈", ["창문 닫음"]],
  ["20:15", "v", -0.0025, 0.0028, 5, "양돈", ["잠 못 잠"]],
  ["20:40", "v", 0.0, 0.0018, 4, "양돈", ["외출 어려움"]],
  ["21:10", "c", 0.0015, 0.0012, 2, "양돈", []],
  ["21:35", "v", 0.0018, 0.0008, 3, "양돈", []],
  ["22:05", "v", -0.0008, -0.0025, 4, "액비", ["창문 닫음"]],
  ["22:30", "v", 0.0028, 0.0002, 5, "양돈", ["두통"]],
  ["22:55", "v", -0.0018, -0.0018, 3, "양돈", []],
];

const argDay = process.argv[2];
const day = argDay ?? seoulDay(new Date());
if (!isValidDay(day)) {
  console.error(`날짜 형식이 잘못됐어요: ${day} (예: 2026-11-04)`);
  process.exit(1);
}

const db = await openDb();
try {
  const removed = await db.tx(async (q) => {
    const [from, to] = dayRange(day);
    const { rows } = await q.query<{ id: number }>(
      `DELETE FROM reports WHERE is_demo AND reported_at >= $1 AND reported_at < $2 RETURNING id`,
      [from, to],
    );
    for (const [i, [time, base, dLat, dLng, intensity, odor, symptoms]] of SEEDS.entries()) {
      const origin = base === "v" ? VILLAGE : COAST;
      const grid = toGrid({ lat: origin.lat + dLat, lng: origin.lng + dLng });
      await q.query(
        `INSERT INTO reports (user_hash, intensity, intensity_src, odor_type, symptoms, consent_version,
           grid_lat, grid_lng, needs_review, merged_count, is_demo, reported_at)
         VALUES ($1, $2, 'button', $3, $4::jsonb, $5, $6, $7, FALSE, 1, TRUE, $8)`,
        [hashUserId(`demo-resident-${i}`), intensity, odor, JSON.stringify(symptoms), CONSENT_VERSION, grid.lat, grid.lng, `${day}T${time}:00+09:00`],
      );
    }
    return rows.length;
  });
  console.log(`${day}: 시연 제보 ${SEEDS.length}건 입력 (이전 시연 데이터 ${removed}건 삭제)`);
} finally {
  await db.close();
}
