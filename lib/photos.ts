import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { DB } from "./db";
import type { PhotoStore } from "./storage";
import { seoulDay } from "./time";

export const PHOTO_RULES = {
  /** 업로드 원본 최대 크기 */
  maxUploadBytes: 10 * 1024 * 1024,
  /** 저장 이미지 긴 변 */
  maxSide: 1280,
  /** 합쳐진 제보 포함, 한 제보에 붙는 사진 수 */
  maxPerReport: 3,
} as const;

export type PhotoResult = "saved" | "invalid" | "too_large" | "limit" | "failed";

/**
 * 사진을 다시 인코딩한다. 회전만 반영하고 EXIF(촬영 위치·기기 정보)는 모두 버린다.
 * 이미지가 아니면 throw.
 */
export async function processPhoto(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "error", limitInputPixels: 60_000_000 })
    .rotate()
    .resize({ width: PHOTO_RULES.maxSide, height: PHOTO_RULES.maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}

/**
 * 저장된 제보에 사진을 붙인다. 사진이 실패해도 제보는 그대로 둔다.
 * 순서: 크기 확인 → 재인코딩 → (제보 행 잠금 → 개수 확인 → 행 예약) → MinIO 업로드.
 * 업로드가 실패하면 예약한 행을 지운다. 동시 첨부도 제보 행 잠금 덕에 한도를 넘지 않는다.
 */
export async function attachPhoto(
  db: DB,
  store: PhotoStore,
  reportId: number,
  raw: Buffer,
  now = new Date(),
): Promise<PhotoResult> {
  if (raw.length > PHOTO_RULES.maxUploadBytes) return "too_large";

  let jpeg: Buffer;
  try {
    jpeg = await processPhoto(raw);
  } catch {
    return "invalid";
  }

  // 키에는 날짜와 임의 값만 넣는다 (제보자·좌표 정보 없음)
  const key = `reports/${seoulDay(now)}/${randomUUID()}.jpg`;
  let reserved: "ok" | "limit" | "gone";
  try {
    reserved = await db.tx(async (q) => {
      const locked = await q.query(`SELECT id FROM reports WHERE id = $1 FOR UPDATE`, [reportId]);
      if (!locked.rows[0]) return "gone" as const;
      const { rows } = await q.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM report_photos WHERE report_id = $1`,
        [reportId],
      );
      if (rows[0].n >= PHOTO_RULES.maxPerReport) return "limit" as const;
      await q.query(`INSERT INTO report_photos (report_id, object_key, bytes) VALUES ($1, $2, $3)`, [
        reportId,
        key,
        jpeg.length,
      ]);
      return "ok" as const;
    });
  } catch (e) {
    console.error("[photo] DB 저장 실패", (e as Error).name);
    return "failed";
  }
  if (reserved === "limit") return "limit";
  if (reserved === "gone") return "failed";

  try {
    await store.put(key, jpeg, "image/jpeg");
    await db.query(`UPDATE report_photos SET uploaded = TRUE WHERE object_key = $1`, [key]);
  } catch (e) {
    console.error("[photo] 업로드 실패", (e as Error).name);
    await db.query(`DELETE FROM report_photos WHERE object_key = $1`, [key]).catch(() => {});
    // 저장은 됐는데 응답만 유실된 경우를 위해 객체도 지워 본다
    await store.delete(key).catch(() => console.error("[photo] 고아 객체 정리 실패", key));
    return "failed";
  }
  return "saved";
}

/** 공개용 사진. 확인 필요 제보의 사진은 내보내지 않는다. */
export async function getPublicPhoto(
  db: DB,
  store: PhotoStore,
  photoId: number,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  const { rows } = await db.query<{ object_key: string }>(
    `SELECT p.object_key FROM report_photos p JOIN reports r ON r.id = p.report_id
     WHERE p.id = $1 AND p.uploaded AND r.needs_review = FALSE`,
    [photoId],
  );
  if (!rows[0]) return null;
  return store.get(rows[0].object_key);
}
