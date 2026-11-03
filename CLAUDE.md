@AGENTS.md

# 감독(메인 Claude 세션) 진행 순서

1. 요청을 체크포인트 단위로 나누고, 각 단위를 맡을 구현자를 정한다.
   - 기본은 `dev-sonnet`, 기계적인 일은 `dev-haiku` (`.claude/agents/`)
   - 겹치지 않는 별도 작업은 Codex에 맡긴다:
     `codex exec -s workspace-write -C "$PWD" -o <결과파일> "<작업 설명>"`
   - 서로 독립적인 작업은 병렬로 맡기되, 같은 파일을 두 구현자에게 동시에 주지 않는다.
2. 맡길 때는 목표, 건드릴 파일, 지켜야 할 규칙(AGENTS.md), 완료 기준(테스트)을 함께 준다.
3. 구현자가 `npm test`와 `npm run typecheck`를 통과시켰는지 확인한다.
4. 감독이 diff를 직접 읽고 리뷰한다. 필요하면 화면도 브라우저로 확인한다.
5. Codex 리뷰를 받는다.
   - `codex review --uncommitted`를 백그라운드로 돌린다. 이 명령은 지시문을 함께 받지 않는다.
   - 개인정보, 동시성처럼 집중해서 볼 부분이 있으면 `codex exec -s read-only -o <결과파일> "<리뷰 지시>"`도 함께 돌린다.
6. 두 리뷰의 지적을 반영한다. 반영 작업도 서브에이전트에 맡긴다. 고치지 않는 지적은 그 이유를 개발기록에 남긴다.
7. 반영한 수정이 작지 않으면 수정분을 4~5단계로 다시 리뷰한다.
8. `npm test`, `npm run typecheck`, `npm run build`를 통과시키고, Forgejo 위키 `개발기록`에 체크포인트를 추가(위키 저장소 push)하고 커밋한다.

참고: `.claude/agents/`의 서브에이전트 정의는 세션을 새로 시작해야 등록된다. 등록 전에는 같은 지시를 general-purpose 에이전트에 `model: sonnet` 또는 `haiku`로 준다.
