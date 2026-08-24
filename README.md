# 반복학습

어제 공부한 내용을 채팅으로 Claude에게 주면(URL 또는 텍스트) 정리해서 Airtable에 복습 카드로 저장하고,
차 안에서 음성으로 신규학습/복습을 진행하는 개인용 학습 앱. 출근길엔 신규학습, 퇴근길엔 복습.
`나의취향`/`품질관리_블로그자동화` 프로젝트와 같은 구조(n8n 웹훅 ↔ Airtable ↔ GitHub Pages)로 만들었습니다.

- `index.html` + `app.js` + `style.css` — **음성 학습 앱**. 홈에서 "신규학습" / "복습" 선택.
  - 신규학습: 세션당 새 카드 5~8개, Pimsleur 방식(즉시→1분→5분→15분)으로 그날 안에 여러 번 재확인해서
    통과하면 "졸업"(그날 저녁부터 복습 대상).
  - 복습: SM-2 알고리즘으로 오늘 복습할 카드를 골라서(오늘 졸업한 것 + 예전 것 섞어서) 순서대로 질문.
  - 정답/오답 모두 Gemini가 채점하고, 발음이 의심되면 짧은 발음 팁도 함께 줍니다.
- `admin.html` + `admin.js` + `admin_style.css` — **화면 확인 앱**. 자료별("면세점영어" 같은 단위)
  총 반복횟수/최근 학습일 통계를 보고, Claude가 만든 카드 내용이 이상하면 수정하거나 삭제.
- `srs-utils.js` — 신규학습 스케줄러(그라데이션 리콜) 로직. `tests/srs-utils.test.js`로 테스트됨(`node --test tests/srs-utils.test.js`).
- `n8n_workflow.json` — n8n 백엔드 (웹훅 7개, "RepeatStudy - Backend").
- `LESSONS_LEARNED.md` — 개발하면서 겪은 오류/삽질과 해결법 모음. 비슷한 구조(n8n+Airtable+GitHub Pages+
  음성 웹앱)로 다음 프로젝트 만들 때 먼저 훑어볼 것.
- `AIRTABLE_SCHEMA.md` — 이미 만들어진 Airtable 베이스의 테이블/필드 구조.
- `docs/airtable-ids.json` — 베이스/테이블 ID.
- `docs/superpowers/specs/2026-08-22-repeat-study-design.md` — 설계 배경과 결정 이유 전체 기록.
- `DEPLOY_GUIDE.md` — 배포 방법 (가장 먼저 읽어보세요).

## Airtable은 이미 준비되어 있어요

이번엔 Airtable 베이스("반복학습")를 Claude가 MCP로 직접 만들어뒀습니다. 샘플 자료 1개("샘플: 비즈니스
영어")와 카드 3개(신규 2개, 복습 대상 1개)도 넣어뒀으니, n8n 웹훅만 연결하면 바로 테스트해볼 수 있어요.

## 콘텐츠는 어떻게 넣나요?

파일 업로드나 폴더 감시 없이, 이 채팅창에서 Claude에게 공부한 내용의 URL이나 텍스트를 주시면 됩니다.
Claude가 내용을 정리해서 카드 8~15개를 만들고 Airtable에 바로 저장해드려요. 예: "이 페이지 면세점 영어
표현으로 카드 만들어줘 [URL]".
