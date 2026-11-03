<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 제주숨결봇 프로젝트 규칙

이 파일은 모든 에이전트(Claude, 서브에이전트, Codex)가 함께 따르는 규칙이다. 위의 Next.js 블록은 `next dev`가 관리하므로 고치지 않는다.

## 문서

| 파일 | 내용 | 언제 고치나 |
| --- | --- | --- |
| `docs/PRD.md` | 개발 요구사항 (기준 문서) | 동작·API·스키마가 바뀌면 같은 커밋에서 |
| `docs/기획서.md` | 기획 배경·위험 분석 | 기획 방향이 바뀔 때 |
| `docs/개발기록.md` | 체크포인트별 기록 (무엇을, 왜, 리뷰 결과, 남은 일) | 커밋할 때마다 |
| `README.md` | 실행 방법·명령·구성 | 실행 방법이 바뀌면 |

## 작업 방식

- **감독(메인 Claude 세션)**: 작업을 나누고, 구현을 맡기고, 결과를 리뷰하고, 합치고, 커밋한다. 직접 구현은 작은 수정과 연결 코드만 한다.
- **구현**: 기본은 서브에이전트.
  - `dev-sonnet` (Sonnet): 판단이 필요한 기능 구현, 여러 파일에 걸친 변경
  - `dev-haiku` (Haiku): 기계적인 작업 (문구 수정, 같은 패턴 반복, 테스트 케이스 추가, 문서 정리)
  - Codex (`codex exec`): 다른 작업과 겹치지 않게 떼어 낼 수 있는 작업. 같은 파일을 두 구현자가 동시에 맡지 않는다.
- **리뷰**: 체크포인트마다 커밋 전에 두 가지를 거친다.
  1. 감독이 diff를 직접 읽고 확인
  2. Codex 리뷰: `codex review --uncommitted` (지시문을 함께 줄 수 없다). 특정 부분을 집중해서 봐야 하면 `codex exec -s read-only "<리뷰 지시>"`를 추가로 돌린다.
  지적을 고치지 않기로 하면 그 이유를 `docs/개발기록.md`에 남긴다.

## 체크포인트와 커밋

- 의미 있는 단위(기능 하나, 구조 전환 하나, 버그 수정 묶음)가 끝날 때마다 커밋한다.
- 커밋 전 순서:
  1. 구현 → `npm test`, `npm run typecheck` 통과
  2. 리뷰 두 가지 (감독 직접 + Codex)
  3. 지적 반영 → 다시 `npm test`, `npm run typecheck`
  4. 반영한 수정이 작지 않으면 수정분을 다시 리뷰 (감독 직접 + `codex review --uncommitted`)
  5. `npm run build` 통과 → `docs/개발기록.md` 갱신 → 커밋
- 커밋되는 최종 코드는 리뷰를 거친 상태여야 한다. 리뷰 뒤에 리뷰받지 않은 큰 변경을 끼워 넣지 않는다.
- 커밋 메시지는 한국어. 첫 줄에 요약, 본문에 변경 요점.
- 서브에이전트와 Codex는 커밋하지 않는다. 커밋은 감독만 한다.
- 원격 저장소 push는 사용자가 요청할 때만 한다.
- `.env.local`과 비밀값은 커밋하지 않는다.

## 코드 규칙

- **Next.js 16**: 코드를 쓰기 전에 `node_modules/next/dist/docs/`를 확인한다. 서버 페이지에서 요청마다 값을 읽어야 하면 `await connection()`을 쓴다. `params`와 `searchParams`는 Promise다.
- **개인정보**
  - 로그에 원문, 좌표, user_id, 비밀값을 남기지 않는다.
  - 공개 API에 `user_hash`와 원문을 내보내지 않는다.
  - 원좌표는 판정 직후 지운다.
  - 사진은 EXIF를 지우고 다시 인코딩한 뒤 저장한다.
- **DB**
  - Postgres 연결은 `lib/db.ts`(`pg`)로 한다.
  - 스키마를 바꾸면 `lib/db.ts`의 `SCHEMA`와 `docs/PRD.md` 7장을 함께 고친다.
  - 테스트는 `tests/pg.ts`(메모리 PGlite)를 쓰고, stage DB에 테스트 데이터를 쓰지 않는다.
- **사진 저장소**
  - 저장은 `lib/storage.ts`를 거친다.
  - MinIO는 `jeju-breath` 버킷만 쓰고, 버킷은 비공개로 둔다.
  - 사진은 `/api/photos/{id}`로만 내보낸다.
- **AI**
  - 추출은 `lib/claude.ts`에서 `claude-haiku-5-5`로 하고, 도구 호출로 출력 형식을 고정한다.
  - `temperature`는 보내지 않는다 (400 오류).
  - 실패하면 강도 버튼 질문으로 넘어간다.
- **화면 문구**: 고령 사용자 기준의 쉬운 존댓말("~해요")을 쓴다. 버튼은 56px 이상, 본문 글자는 18px로 한다.
- **stage 서버**
  - 접속 정보는 `.env.local`에만 둔다.
  - Postgres는 TLS로만 접속한다. `jeju_breath` 계정은 TLS 없는 접속이 서버에서 거부된다. 신뢰할 인증서는 `certs/stage-postgres.crt`이고, `DATABASE_URL`에 `sslmode=verify-ca`로 지정한다.
  - MinIO는 HTTPS 주소 `https://<s3-host>`(Traefik, Let's Encrypt)로 접속한다. `http://<stage-host>:9000`은 암호화되지 않으므로 쓰지 않는다.
  - 예외: stage 서버 안의 컨테이너는 도커 내부망 `http://minio:9000`을 쓴다. 같은 호스트 안이라 트래픽이 서버 밖으로 나가지 않고, HTTPS 주소는 Cloudflare를 돌아 들어온다.
  - Postgres와 MinIO는 다른 앱과 함께 쓰는 서버다. 서버 설정을 바꿀 때는 다른 앱의 접속에 영향이 없게 하고, 무엇을 바꿨는지 개발기록에 남긴다.
  - 시험 데이터를 넣었으면 끝난 뒤 지운다. 시연 데이터는 `is_demo = TRUE`로 넣는다.
