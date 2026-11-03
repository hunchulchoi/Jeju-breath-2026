import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PHOTO_RULES, attachPhoto, getPublicPhoto, processPhoto } from "@/lib/photos";
import { listReports, submitReport, type ReportInput } from "@/lib/reports";
import { memoryStore, type PhotoStore } from "@/lib/storage";
import { CONSENT_VERSION } from "@/lib/types";
import { testDb } from "./pg";

const base: ReportInput = {
  user_id: "11111111-2222-3333-4444-555555555555",
  lat: 33.4625,
  lng: 126.3305,
  accuracy: 20,
  intensity: 4,
  odor_type: "양돈",
  consent_version: CONSENT_VERSION,
};
const now = new Date("2026-11-03T19:00:00+09:00");

// 촬영 정보(EXIF)가 들어 있는 큰 JPEG
const photoWithExif = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#8a7" } })
    .jpeg()
    .withExif({ IFD0: { Make: "TestPhone", Copyright: "홍길동" } })
    .toBuffer();

let db: Awaited<ReturnType<typeof testDb>>;
let store: ReturnType<typeof memoryStore>;
beforeAll(async () => {
  db = await testDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.reset();
  store = memoryStore();
});

async function saveReport(input = base) {
  const r = await submitReport(db, input, now);
  if (!r.ok) throw new Error("저장 실패");
  return r.id;
}

describe("사진 재처리", () => {
  it("EXIF를 지우고 긴 변을 1280px로 줄인다", async () => {
    const raw = await photoWithExif();
    expect((await sharp(raw).metadata()).exif).toBeDefined();
    const out = await processPhoto(raw);
    const meta = await sharp(out).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(PHOTO_RULES.maxSide);
  });

  it("이미지가 아니면 거절한다", async () => {
    await expect(processPhoto(Buffer.from("not an image"))).rejects.toThrow();
  });
});

describe("사진 첨부", () => {
  it("MinIO에 올리고 목록에 사진 번호를 내보낸다. 키에는 제보자 정보가 없다", async () => {
    const id = await saveReport();
    expect(await attachPhoto(db, store, id, await photoWithExif(), now)).toBe("saved");
    const [key] = [...store.objects.keys()];
    expect(key).toMatch(/^reports\/2026-11-03\/[0-9a-f-]{36}\.jpg$/);
    const [r] = await listReports(db, "2026-11-03");
    expect(r.photo_ids).toHaveLength(1);
    const photo = await getPublicPhoto(db, store, r.photo_ids[0]);
    expect(photo?.contentType).toBe("image/jpeg");
  });

  it("업로드가 끝나기 전에는 목록에 사진 번호를 내보내지 않는다", async () => {
    const id = await saveReport();
    let release!: () => void;
    let putStarted!: () => void;
    const started = new Promise<void>((r) => (putStarted = r));
    const slow: PhotoStore = {
      ...store,
      async put(key, body, contentType) {
        putStarted();
        await new Promise<void>((r) => (release = r));
        await store.put(key, body, contentType);
      },
    };
    const pending = attachPhoto(db, slow, id, await photoWithExif(), now);
    await started;
    const [during] = await listReports(db, "2026-11-03");
    expect(during.photo_ids).toEqual([]);
    release();
    expect(await pending).toBe("saved");
    const [after] = await listReports(db, "2026-11-03");
    expect(after.photo_ids).toHaveLength(1);
  });

  it("사진 없는 제보는 빈 배열", async () => {
    await saveReport();
    const [r] = await listReports(db, "2026-11-03");
    expect(r.photo_ids).toEqual([]);
  });

  it("이미지가 아니면 invalid, 저장소와 DB에 아무것도 남지 않는다", async () => {
    const id = await saveReport();
    expect(await attachPhoto(db, store, id, Buffer.from("hello"), now)).toBe("invalid");
    expect(store.objects.size).toBe(0);
    const [r] = await listReports(db, "2026-11-03");
    expect(r.photo_ids).toEqual([]);
  });

  it("한 제보에 3장까지", async () => {
    const id = await saveReport();
    const raw = await photoWithExif();
    for (let i = 0; i < 3; i++) expect(await attachPhoto(db, store, id, raw, now)).toBe("saved");
    expect(await attachPhoto(db, store, id, raw, now)).toBe("limit");
    expect(store.objects.size).toBe(3);
  });

  it("10MB 넘으면 too_large", async () => {
    const id = await saveReport();
    expect(await attachPhoto(db, store, id, Buffer.alloc(PHOTO_RULES.maxUploadBytes + 1), now)).toBe("too_large");
  });

  it("업로드가 실패해도 제보는 남고 사진 행은 생기지 않는다", async () => {
    const id = await saveReport();
    const broken: PhotoStore = { ...store, put: async () => Promise.reject(new Error("down")) };
    expect(await attachPhoto(db, broken, id, await photoWithExif(), now)).toBe("failed");
    const [r] = await listReports(db, "2026-11-03");
    expect(r).toMatchObject({ id, photo_ids: [] });
    const { rows } = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM report_photos");
    expect(rows[0].n).toBe(0);
  });

  it("동시에 첨부해도 3장을 넘지 않는다", async () => {
    const id = await saveReport();
    const raw = await photoWithExif();
    for (let i = 0; i < 2; i++) expect(await attachPhoto(db, store, id, raw, now)).toBe("saved");
    const results = await Promise.all([attachPhoto(db, store, id, raw, now), attachPhoto(db, store, id, raw, now)]);
    expect(results.filter((r) => r === "saved")).toHaveLength(1);
    expect(results.filter((r) => r === "limit")).toHaveLength(1);
    expect(store.objects.size).toBe(3);
    const { rows } = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM report_photos");
    expect(rows[0].n).toBe(3);
  });

  it("제보가 없으면 failed", async () => {
    expect(await attachPhoto(db, store, 9999, await photoWithExif(), now)).toBe("failed");
    expect(store.objects.size).toBe(0);
  });

  it("확인 필요 제보의 사진은 공개하지 않는다", async () => {
    await saveReport();
    // 5분 뒤 6km 떨어진 곳 → 확인 필요
    const far = await submitReport(db, { ...base, lat: base.lat - 0.06 }, new Date(now.getTime() + 5 * 60_000));
    if (!far.ok) throw new Error();
    expect(far.needs_review).toBe(true);
    expect(await attachPhoto(db, store, far.id, await photoWithExif(), now)).toBe("saved");
    const flagged = (await listReports(db, "2026-11-03")).find((r) => r.id === far.id)!;
    expect(flagged.photo_ids).toEqual([]);
    const { rows } = await db.query<{ id: number }>("SELECT id FROM report_photos");
    expect(await getPublicPhoto(db, store, rows[0].id)).toBeNull();
  });

  it("put이 객체를 저장한 뒤 throw해도 객체와 예약 행을 남기지 않는다", async () => {
    const id = await saveReport();
    const flaky: PhotoStore = {
      ...store,
      async put(key, body, contentType) {
        await store.put(key, body, contentType);
        throw new Error("응답 유실");
      },
    };
    expect(await attachPhoto(db, flaky, id, await photoWithExif(), now)).toBe("failed");
    expect(store.objects.size).toBe(0);
    const n = (await db.query<{ c: number }>("SELECT COUNT(*)::int c FROM report_photos")).rows[0].c;
    expect(n).toBe(0);
  });

});
