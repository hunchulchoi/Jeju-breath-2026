// 테스트용 Postgres: 메모리에서 도는 PGlite. stage DB를 건드리지 않는다.
import { PGlite } from "@electric-sql/pglite";
import { SCHEMA, type DB, type Queryable } from "@/lib/db";

export async function testDb(): Promise<DB & { reset(): Promise<void> }> {
  const pg = new PGlite();
  await pg.exec(SCHEMA);
  const wrap = (q: { query: PGlite["query"] }): Queryable => ({
    query: async (sql, params) => q.query(sql, params) as never,
  });
  return {
    ...wrap(pg),
    tx: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    close: () => pg.close(),
    async reset() {
      await pg.exec(
        "TRUNCATE reports, report_photos, location_failures, event_counts, kakao_drafts RESTART IDENTITY CASCADE",
      );
    },
  };
}
