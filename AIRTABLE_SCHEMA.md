# Airtable 스키마 (실제로 생성됨)

베이스 이름: **반복학습** (`appnIQ0eb9IPrQGCt`, 워크스페이스 `wspM4cjxuM52BmpYX` — 나의취향 베이스와 같은
워크스페이스). ID 전체 목록은 `docs/airtable-ids.json` 참고. 아래 테이블/필드는 Airtable MCP로 이미
만들어져 있어서, 별도로 만드실 필요 없습니다.

## 1. 학습자료

채팅으로 전달한 URL/텍스트 단위 자료(예: "면세점영어"). 카드들의 상위 묶음이자 통계 집계 단위.

| 필드명 | 타입 | 설명 |
|---|---|---|
| 제목 | Single line text (기본필드) | 예: "면세점영어" |
| 출처유형 | Single select (URL/텍스트) | |
| 출처URL | URL | 출처유형=URL일 때만 |
| 등록일 | Date | |

## 2. 카드

간격반복(SRS) 대상 개별 문제 카드.

| 필드명 | 타입 | 설명 |
|---|---|---|
| 질문 | Long text (기본필드) | |
| 자료 | Link to 학습자료 | |
| 자료명 | Lookup (자료.제목) | 웹훅 응답에 자료 제목을 바로 실어주기 위한 편의 필드 |
| 모범답안 | Long text | |
| 힌트 | Long text | |
| 유형 | Single select (VOCAB/QA/CONCEPT) | |
| 단계 | Single select (신규/복습) | 신규=세션 내 그라데이션 리콜 대상, 복습=SM-2 대상 |
| 이지팩터 | Number (소수 2자리) | SM-2 ease factor, 기본 2.5, 최소 1.3 |
| 간격일수 | Number | 현재 복습 간격(일) |
| 다음복습일 | Date | 이 값이 오늘 이하면 복습 대상 |
| 복습횟수 | Number | SM-2 복습 실행 횟수 (신규 단계에서는 증가 안 함) |
| 최근결과 | Single select (정답/오답/미학습) | |
| 활성 | Checkbox | 앱에 노출할지 여부 |

## 3. 복습기록

매 답변마다 남는 로그. 통계(자료별 총 반복횟수/최근학습일) 집계에 쓰임.

| 필드명 | 타입 | 설명 |
|---|---|---|
| 일시 | Date+Time (기본필드, Asia/Seoul) | |
| 카드ID | Single line text | 카드 테이블 레코드의 Airtable 식별자(rec...)를 그대로 저장 (Link 필드 아님 — 이유는 설계문서 참고) |
| 모드 | Single select (VOICE/SCREEN) | |
| 단계 | Single select (신규/복습) | |
| 사용자답변 | Long text | |
| 정답여부 | Checkbox | |
| 점수 | Number | Gemini가 준 0~100 유사도 점수 |
| 피드백 | Long text | |
| 발음팁 | Long text | 비어있으면 발음 문제 없음 |

## 카드 식별자 규칙

이 베이스는 별도 자동번호(card_id) 필드를 쓰지 않고, **Airtable의 네이티브 레코드 ID(rec...)**를
그대로 카드 식별자로 씁니다 (나의취향 프로젝트의 admin-utils.js가 하는 방식과 동일). n8n 웹훅이 카드를
조회해서 앱에 내려줄 때 `id` 필드로 이 레코드ID를 함께 보내고, 앱이 채점/졸업/수정 요청을 보낼 때 그
`id`를 그대로 돌려보내는 식입니다.

## 콘텐츠가 들어오는 방식

n8n이 아니라 **이 채팅에서 Claude가 Airtable MCP로 직접** `학습자료`+`카드` 레코드를 생성합니다
(사용자가 URL/텍스트를 채팅으로 주면). 자세한 흐름은
`docs/superpowers/specs/2026-08-22-repeat-study-design.md` 4번 항목 참고.
