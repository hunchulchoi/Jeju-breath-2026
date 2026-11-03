# 제주숨결봇 (Jeju Breath Bot)

한 문장으로 악취를 제보하면 위치·시각·강도가 날짜별 지도에 쌓이는 PoC입니다. 요구사항은 [docs/PRD.md](docs/PRD.md), 배경과 위험 분석은 [docs/기획서.md](docs/기획서.md)에 있습니다.

## 실행

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY, USER_HASH_SALT 채우기
npm run seed                 # 오늘 날짜 시연 제보 20건 (다른 날: npm run seed -- 2026-11-04)
npm run dev                  # http://localhost:3000
```

- 위치 권한은 HTTPS나 `localhost`에서만 동작합니다. 휴대폰으로 시험하려면 HTTPS 주소(배포 또는 터널)가 필요합니다.
- `ANTHROPIC_API_KEY`가 없거나 API가 5초 안에 답하지 않으면 강도 버튼 질문으로 넘어갑니다 (PRD 6.3).
- `DEMO_MODE=true`면 위치 확인 화면에 [테스트 좌표 사용] 토글이 보입니다. 운영에서는 `false`로 둡니다.

## 명령

| 명령 | 설명 |
| --- | --- |
| `npm test` | 규칙(격자·중복·허위·제주 범위)·마스킹·저장·AI 실패 처리 테스트 |
| `npm run eval` | 평가용 20문장 AI 강도 정확도 (기준 18개 이상, API 키 필요). `-- --split tune`으로 조정용 40문장 |
| `npm run seed` | 시연 데이터 다시 넣기 (그 날짜 시연 데이터만 지우고 새로 넣음) |
| `npm run build` | 운영 빌드 |

## 구성

| 경로 | 내용 |
| --- | --- |
| `app/report` | 채팅 제보 → 위치 확인 → AI 처리 → 강도 확인 → 접수 |
| `app/map` | 날짜별 지도·목록 (Leaflet + OpenStreetMap), 같은 200m 칸은 마커 하나로 묶음 |
| `app/api/*` | PRD 8장 API + 지표용 `/api/events`, `/api/metrics` |
| `lib/rules.ts` | 위치 검사, 격자, 중복·허위 판정 |
| `lib/claude.ts` | Claude Haiku 5.5 추출 (도구 호출로 형식 고정), 실패 처리 |
| `lib/reports.ts` | 저장·조회·요약·지표 |
| `eval/sentences.json` | 평가 문장 60개 (**초안**, 팀 문장으로 교체 필요) |

## 개인정보

- 제보자 ID는 브라우저에서 만든 랜덤 값을 `SHA-256(salt + ID)`로만 저장합니다.
- 원문은 전화번호·이메일·이름 패턴을 가린 뒤 저장하고, 원좌표는 판정 직후 지웁니다.
- 지도·목록 API는 격자 좌표만 내보내고, 제보자 해시와 원문은 내보내지 않습니다.
