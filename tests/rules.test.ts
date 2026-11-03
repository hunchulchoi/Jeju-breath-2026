import { describe, expect, it } from "vitest";
import {
  checkLocation,
  checkSuspicious,
  distanceMeters,
  findDuplicate,
  isInJeju,
  toGrid,
  type PriorReport,
} from "@/lib/rules";

const AEWOL = { lat: 33.4625, lng: 126.3305 };
const t = (iso: string) => new Date(iso);
// 위도 0.001° ≈ 111m
const north = (p: { lat: number; lng: number }, meters: number) => ({ lat: p.lat + meters / 111_320, lng: p.lng });

describe("제주 범위·위치 검사", () => {
  it("애월은 제주 범위 안, 서울은 밖", () => {
    expect(isInJeju(AEWOL)).toBe(true);
    expect(isInJeju({ lat: 37.5665, lng: 126.978 })).toBe(false);
  });

  it("좌표가 없거나 숫자가 아니면 missing", () => {
    expect(checkLocation({})).toEqual({ ok: false, problem: "missing" });
    expect(checkLocation({ lat: "33", lng: 126 })).toEqual({ ok: false, problem: "missing" });
    expect(checkLocation({ lat: NaN, lng: 126.3 })).toEqual({ ok: false, problem: "missing" });
  });

  it("정확도 200m 초과면 low_accuracy, 200m 이하는 통과", () => {
    expect(checkLocation({ ...AEWOL, accuracy: 201 })).toEqual({ ok: false, problem: "low_accuracy" });
    expect(checkLocation({ ...AEWOL, accuracy: 200 }).ok).toBe(true);
  });

  it("제주 밖이면 out_of_bounds", () => {
    expect(checkLocation({ lat: 35.1, lng: 129.0, accuracy: 10 })).toEqual({ ok: false, problem: "out_of_bounds" });
  });
});

describe("격자 (근사 위치)", () => {
  it("격자 중심은 원좌표에서 약 141m(대각선 절반) 이내", () => {
    for (const d of [0, 37, 95, 150, 199]) {
      const p = north(AEWOL, d);
      expect(distanceMeters(p, toGrid(p))).toBeLessThanOrEqual(142);
    }
  });

  it("같은 칸의 두 점은 같은 격자 좌표가 된다", () => {
    const g = toGrid(AEWOL);
    expect(toGrid(g)).toEqual(g);
  });

  it("멀리 떨어진 점은 다른 격자", () => {
    expect(toGrid(AEWOL)).not.toEqual(toGrid(north(AEWOL, 400)));
  });
});

describe("중복 판정 (30분·300m)", () => {
  const prior = (id: number, point: { lat: number; lng: number }, iso: string): PriorReport => ({
    id,
    point,
    reportedAt: t(iso),
  });

  it("20분 뒤 100m 안이면 중복", () => {
    const priors = [prior(1, AEWOL, "2026-11-03T19:00:00+09:00")];
    expect(findDuplicate(north(AEWOL, 100), t("2026-11-03T19:20:00+09:00"), priors)?.id).toBe(1);
  });

  it("31분 뒤면 중복 아님", () => {
    const priors = [prior(1, AEWOL, "2026-11-03T19:00:00+09:00")];
    expect(findDuplicate(AEWOL, t("2026-11-03T19:31:00+09:00"), priors)).toBeNull();
  });

  it("400m 떨어지면 중복 아님", () => {
    const priors = [prior(1, AEWOL, "2026-11-03T19:00:00+09:00")];
    expect(findDuplicate(north(AEWOL, 400), t("2026-11-03T19:05:00+09:00"), priors)).toBeNull();
  });

  it("후보가 여럿이면 가장 최근 제보로 합친다", () => {
    const priors = [
      prior(1, AEWOL, "2026-11-03T19:00:00+09:00"),
      prior(2, AEWOL, "2026-11-03T19:10:00+09:00"),
    ];
    expect(findDuplicate(AEWOL, t("2026-11-03T19:15:00+09:00"), priors)?.id).toBe(2);
  });
});

describe("허위 의심 판정", () => {
  it("10분 안에 5km 이상 이동하면 impossible_move", () => {
    const priors: PriorReport[] = [{ id: 1, point: AEWOL, reportedAt: t("2026-11-03T19:00:00+09:00") }];
    expect(checkSuspicious(north(AEWOL, 6000), t("2026-11-03T19:08:00+09:00"), priors)).toBe("impossible_move");
  });

  it("20분 뒤 6km 이동은 정상", () => {
    const priors: PriorReport[] = [{ id: 1, point: AEWOL, reportedAt: t("2026-11-03T19:00:00+09:00") }];
    expect(checkSuspicious(north(AEWOL, 6000), t("2026-11-03T19:20:00+09:00"), priors)).toBeNull();
  });

  it("1시간 안에 5건은 정상, 6번째부터 too_many", () => {
    const mk = (n: number): PriorReport[] =>
      Array.from({ length: n }, (_, i) => ({
        id: i,
        point: north(AEWOL, i * 500),
        reportedAt: t(`2026-11-03T19:${String(i * 5).padStart(2, "0")}:00+09:00`),
      }));
    const now = t("2026-11-03T19:50:00+09:00");
    expect(checkSuspicious(north(AEWOL, 3000), now, mk(4))).toBeNull();
    expect(checkSuspicious(north(AEWOL, 3000), now, mk(5))).toBe("too_many");
  });
});
