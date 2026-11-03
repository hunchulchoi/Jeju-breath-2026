import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_hash     TEXT NOT NULL,
  text_masked   TEXT NOT NULL,
  intensity     INTEGER NOT NULL CHECK (intensity BETWEEN 1 AND 5),
  intensity_src TEXT NOT NULL CHECK (intensity_src IN ('ai','button')),
  odor_type     TEXT NOT NULL,
  symptoms      TEXT NOT NULL DEFAULT '[]',
  confidence    REAL,
  grid_lat      REAL NOT NULL,
  grid_lng      REAL NOT NULL,
  raw_lat       REAL,
  raw_lng       REAL,
  needs_review  INTEGER NOT NULL DEFAULT 0,
  merged_count  INTEGER NOT NULL DEFAULT 1,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  reported_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_date ON reports (reported_at);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports (user_hash, reported_at);

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

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function defaultDbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "data", "jeju.db");
}

// 개발 서버의 핫 리로드에서도 연결을 하나만 쓰도록 globalThis에 둔다.
const g = globalThis as unknown as { __jejuDb?: DB };

export function getDb(): DB {
  g.__jejuDb ??= openDb(defaultDbPath());
  return g.__jejuDb;
}
