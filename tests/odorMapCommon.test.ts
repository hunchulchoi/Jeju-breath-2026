import { describe, expect, it } from "vitest";
import { markerZ, overflowPan, popupMaxSize, Z_REPORT_BASE , weatherBadge, groupReports, markerHtml, findHighlightGroup, nearestPoint, airEmoji, buildInfoContent, infoBubbleHtml, infoFooter, windState } from "@/app/components/odorMapCommon";

const map = { left: 0, top: 0, right: 400, bottom: 300 };
const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe("overflowPan", () => {
  it("fully inside: no pan", () => {
    expect(overflowPan(box(50, 50, 300, 200), map, 12)).toEqual({ dx: 0, dy: 0 });
  });
  it("top overflow moves center up (negative dy)", () => {
    expect(overflowPan(box(50, -20, 300, 100), map, 12)).toEqual({ dx: 0, dy: -32 });
  });
  it("right overflow moves center right, left overflow left", () => {
    expect(overflowPan(box(200, 50, 430, 100), map, 12)).toEqual({ dx: 42, dy: 0 });
    expect(overflowPan(box(-30, 50, 120, 100), map, 12)).toEqual({ dx: -42, dy: 0 });
  });
  it("bottom overflow moves center down", () => {
    expect(overflowPan(box(50, 200, 300, 310), map, 12)).toEqual({ dx: 0, dy: 22 });
  });
  it("corner overflow handles both axes", () => {
    expect(overflowPan(box(300, -5, 420, 100), map, 0)).toEqual({ dx: 20, dy: -5 });
  });
  it("popup larger than map: keeps top/left edge visible", () => {
    const r = overflowPan(box(10, 20, 500, 400), map, 12);
    expect(r.dx).toBe(0 + Math.min(500 - 388, 10 - 12));
    expect(r.dy).toBe(Math.min(400 - 288, 20 - 12));
  });
});

describe("popupMaxSize", () => {
  it("fits width within map minus margins", () => {
    expect(popupMaxSize(360, 600, 20, 12, 800).maxWidth).toBe(336);
  });
  it("small map (40vh) limits height below 45vh", () => {
    const { maxHeight } = popupMaxSize(360, 280, 20, 12, 700);
    expect(maxHeight).toBe(280 - 24 - 20);
  });
  it("tall map capped at 45vh", () => {
    expect(popupMaxSize(360, 900, 20, 12, 700).maxHeight).toBe(315);
  });
});

describe("markerZ", () => {
  it("needs-review always below normal, even with higher index", () => {
    expect(markerZ(5, true)).toBeLessThan(markerZ(0, false));
    expect(markerZ(10_000, true)).toBeLessThan(markerZ(0, false));
  });
  it("keeps group order within a tier", () => {
    expect(markerZ(1, false)).toBeLessThan(markerZ(2, false));
    expect(markerZ(0, true)).toBeLessThan(markerZ(1, true));
  });
  it("stays above me (5) and below popup (1000)", () => {
    expect(markerZ(0, true)).toBeGreaterThanOrEqual(Z_REPORT_BASE);
    expect(markerZ(10_000, false)).toBeLessThan(1000);
  });
});

describe("weatherBadge 바람 정보 없음과 무풍 구분 (Codex 리뷰)", () => {
  const base = { site: "716", name: "애월", lat: 33.46, lng: 126.33, at: "2026-11-04T09:30:00+09:00", temp: 18, humidity: 65, sky: "흐림", rain_1h: null, source: "Open-Meteo" };
  it("풍향이 없고 풍속이 8m/s면 무풍이 아니라 정보 없음", () => {
    const b = weatherBadge({ ...base, wind_speed: 8, wind_dir: null });
    expect(b.html).toContain("정보 없음");
    expect(b.popup).not.toContain("머물 수 있어요");
  });
  it("풍속이 없으면 정보 없음", () => {
    expect(weatherBadge({ ...base, wind_speed: null, wind_dir: 90 }).html).toContain("정보 없음");
  });
  it("풍속 0.3m/s면 무풍 안내", () => {
    const b = weatherBadge({ ...base, wind_speed: 0.3, wind_dir: null });
    expect(b.html).toContain("무풍");
    expect(b.popup).toContain("머물 수 있어요");
  });
  it("동풍 6m/s면 화살표와 서쪽 안내", () => {
    const b = weatherBadge({ ...base, wind_speed: 6, wind_dir: 90 });
    expect(b.popup).toContain("동풍");
    expect(b.popup).toContain("서쪽으로");
  });
});

describe("대기·바람 아이콘 안내", () => {
  const w = { site: "716", name: "애월", lat: 33.46, lng: 126.33, at: "2026-11-04T09:00:00+09:00", temp: 18, humidity: 65, sky: "강수 없음", rain_1h: null, source: "기상청", wind_speed: 4.4, wind_dir: 90 };
  const w2 = { ...w, site: "800", name: "한림", lat: 33.41, lng: 126.26 };
  const st = { site: "716", name: "애월", lat: 33.46, lng: 126.33, approx: false, measured_at: "2026-11-04T09:00:00+09:00", cai: 2 as const, rep_item: null, pm10: 1, pm25: 1, o3: 0.01 };
  const st2 = { ...st, site: "800", name: "한림", lat: 33.41, lng: 126.26 };
  const here = { lat: 33.459, lng: 126.331 };

  it("최근접 지점 선택, 비면 null", () => {
    expect(nearestPoint(here, [w2, w])?.name).toBe("애월");
    expect(nearestPoint(here, [])).toBeNull();
    expect(nearestPoint(here, undefined)).toBeNull();
  });
  it("이모지 매핑", () => {
    expect([1, 2, 3, 4, null].map((c) => airEmoji(c as 1 | 2 | 3 | 4 | null))).toEqual(["😀", "🙂", "😷", "🤢", "❔"]);
  });
  it("대기+바람: 둘 다, aria 문장과 출처·시각", () => {
    const c = buildInfoContent("내 위치", here, [st2, st], [w2, w])!;
    expect(c.air?.label).toBe("보통");
    expect(c.wind?.text).toBe("동풍 4.4m/s · 냄새는 서쪽으로");
    expect(c.head).toBe("내 위치 · 대기 보통");
    expect(c.footer).toBe("애월 측정소 기준 · 기상청 09:00");
    expect(c.aria).toBe("내 위치 대기 보통, 동풍 4.4미터, 냄새는 서쪽으로 퍼질 수 있어요, 애월 측정소 기준 · 기상청 09:00");
    const h = infoBubbleHtml(c, true);
    expect(h).toContain('data-collapsed="true"');
    expect(h).toContain("4.4m/s");
    expect(h).toContain("🙂");
  });
  it("대기만 / 바람만 / 둘 다 없으면 null", () => {
    const a = buildInfoContent("내 위치", here, [st], undefined)!;
    expect(a.wind).toBeNull();
    expect(a.footer).toBe("애월 측정소 기준");
    const b = buildInfoContent("지도 가운데", here, undefined, [w])!;
    expect(b.air).toBeNull();
    expect(b.head).toBe("지도 가운데");
    expect(b.footer).toBe("애월 기준 · 기상청 09:00");
    expect(buildInfoContent("내 위치", here, undefined, undefined)).toBeNull();
    expect(buildInfoContent("내 위치", here, [], [])).toBeNull();
  });
  it("무풍과 바람 정보 없음", () => {
    const calm = buildInfoContent("내 위치", here, undefined, [{ ...w, wind_speed: 0.2, wind_dir: null }])!;
    expect(calm.wind?.kind).toBe("calm");
    expect(calm.wind?.speed).toBe("무풍");
    expect(calm.wind?.text).toContain("머물 수 있어요");
    const miss = buildInfoContent("내 위치", here, undefined, [{ ...w, wind_speed: null }])!;
    expect(miss.wind?.kind).toBe("missing");
    expect(miss.wind?.speed).toBe("-");
    expect(windState({ wind_speed: 8, wind_dir: null }).missing).toBe(true);
  });
  it("대기 등급 모름은 정보 없음", () => {
    expect(buildInfoContent("내 위치", here, [{ ...st, cai: null }], undefined)!.air?.label).toBe("정보 없음");
  });
  it("출처 문구", () => {
    expect(infoFooter(null, null)).toBe("");
    expect(infoFooter(st, { ...w, source: "Open-Meteo" })).toBe("애월 측정소 기준 · Open-Meteo 09:00");
  });
});

describe("방금 내 제보 강조", () => {
  const rep = (id: number, lat: number, intensity = 3, needs_review = false) =>
    ({ id, grid_lat: lat, grid_lng: 126.3, intensity, needs_review, odor_type: "알 수 없음", symptoms: [], photo_ids: [], merged_count: 1, reported_at: "2026-11-04T01:00:00Z" }) as never;
  const groups = groupReports([rep(1, 33.4), rep(2, 33.5), rep(3, 33.5, 2, true)]);
  it("highlights only the cell with the id", () => {
    const html = groups.map((g) => markerHtml(g, 2));
    expect(html.filter((h) => h.includes("odor-mine-label"))).toHaveLength(1);
    expect(html.filter((h) => h.includes('odor-marker odor-mine"'))).toHaveLength(1);
    expect(findHighlightGroup(groups, 2)?.lat).toBe(33.5);
  });
  it("needs_review cell is highlighted separately", () => {
    expect(findHighlightGroup(groups, 3)?.top.needs_review).toBe(true);
    expect(groups.map((g) => markerHtml(g, 3)).filter((h) => h.includes("방금 내 제보"))).toHaveLength(1);
  });
  it("no highlight without id or when id is absent", () => {
    expect(groups.some((g) => markerHtml(g).includes("odor-mine"))).toBe(false);
    expect(findHighlightGroup(groups, 99)).toBeNull();
  });
});
