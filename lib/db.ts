import pg from "pg";

/** pg Pool과 테스트용 PGlite가 함께 맞추는 최소 인터페이스 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface DB extends Queryable {
  /** 한 연결에서 BEGIN … COMMIT. 실패하면 ROLLBACK */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id            SERIAL PRIMARY KEY,
  user_hash     TEXT NOT NULL,
  text_masked   TEXT,
  intensity     INTEGER NOT NULL CHECK (intensity BETWEEN 1 AND 5),
  intensity_src TEXT NOT NULL CHECK (intensity_src IN ('ai','button')),
  odor_type     TEXT NOT NULL,
  symptoms      JSONB NOT NULL DEFAULT '[]',
  confidence    DOUBLE PRECISION,
  grid_lat      DOUBLE PRECISION NOT NULL,
  grid_lng      DOUBLE PRECISION NOT NULL,
  raw_lat       DOUBLE PRECISION,
  raw_lng       DOUBLE PRECISION,
  needs_review  BOOLEAN NOT NULL DEFAULT FALSE,
  merged_count  INTEGER NOT NULL DEFAULT 1,
  is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
  reported_at   TIMESTAMPTZ NOT NULL,
  consent_version TEXT
);
-- 자연어 제보를 없앤 뒤 새 제보는 text_masked가 NULL이다 (기존 행은 그대로 둔다)
ALTER TABLE reports ALTER COLUMN text_masked DROP NOT NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS consent_version TEXT;
CREATE INDEX IF NOT EXISTS idx_reports_date ON reports (reported_at);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports (user_hash, reported_at);

-- 제보 사진. 파일은 MinIO에 두고 여기에는 객체 키만 저장한다.
CREATE TABLE IF NOT EXISTS report_photos (
  id          SERIAL PRIMARY KEY,
  report_id   INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  object_key  TEXT NOT NULL UNIQUE,
  bytes       INTEGER NOT NULL,
  uploaded    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 업로드가 끝난 사진만 공개한다 (예약 행은 개수 제한에만 쓴다)
ALTER TABLE report_photos ADD COLUMN IF NOT EXISTS uploaded BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_report_photos_report ON report_photos (report_id);

CREATE TABLE IF NOT EXISTS location_failures (
  day   TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

-- PoC 지표용 날짜별 이벤트 수 (내용·식별자 없음)
CREATE TABLE IF NOT EXISTS event_counts (
  day   TEXT NOT NULL,
  name  TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name)
);
`;

export function fromPool(pool: pg.Pool): DB {
  return {
    query: async (sql, params) => pool.query(sql, params as unknown[]) as never,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: async (sql, params) => client.query(sql, params as unknown[]) as never });
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function openDb(connectionString = process.env.DATABASE_URL): Promise<DB> {
  if (!connectionString) throw new Error("DATABASE_URL이 없어요. .env.local을 확인해 주세요.");
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 5_000 });
  // 쉬는 연결이 끊겨도 프로세스가 죽지 않게 한다. 접속 정보가 섞이지 않도록 코드만 남긴다.
  pool.on("error", (e) => console.error("[db] 유휴 연결 오류", (e as { code?: string }).code ?? e.name));
  const db = fromPool(pool);
  await db.query(SCHEMA);
  return db;
}

// 개발 서버의 핫 리로드에서도 풀을 하나만 쓰도록 globalThis에 둔다.
const g = globalThis as unknown as { __jejuDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  g.__jejuDb ??= openDb().catch((e) => {
    g.__jejuDb = undefined; // 다음 요청에서 다시 시도
    throw e;
  });
  return g.__jejuDb;
}
