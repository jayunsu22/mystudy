# 배포 & 설정 가이드

## 0. 구조
```
index.html / app.js / style.css       음성 학습 앱
admin.html / admin.js / admin_style.css   화면 확인 앱 (자료별 통계 + 카드 수정/삭제)
srs-utils.js                            공용 SRS 스케줄러 (두 앱 + tests/에서 같이 씀)
n8n_workflow.json                       n8n 백엔드 (웹훅 7개)
AIRTABLE_SCHEMA.md, docs/airtable-ids.json   이미 만들어진 Airtable 베이스 정보
```

## 1. Airtable — 이미 완료됨

베이스 "반복학습"과 테이블 3개(학습자료/카드/복습기록), 샘플 데이터까지 Claude가 미리 만들어뒀습니다.
따로 하실 일 없습니다. 나중에 필드를 더 추가하고 싶으면 `AIRTABLE_SCHEMA.md`를 기준으로 하시면 돼요.

## 2. n8n 워크플로 임포트

지금 레일웨이에서 돌리고 계신 n8n 인스턴스에, **Import from File**로 `n8n_workflow.json` 하나만
불러오면 됩니다 (웹훅 7개가 이 파일 하나에 다 들어있어요, 나의취향 프로젝트와 같은 방식).

1. 임포트 후 워크플로 안의 모든 Airtable 노드에 크리덴셜을 연결하세요. 이름을 `Airtable Personal Access
   Token account 2`로 미리 맞춰뒀으니, 나의취향 프로젝트에서 쓰시던 것과 같은 크리덴셜이면 이름으로
   자동으로 잡힐 수도 있어요. 안 잡히면 수동으로 연결해주세요.
2. `Gemini: 채점` 노드에 Google AI Studio에서 발급한 Gemini API 키를 연결하세요(credentials 또는 URL의
   `key` 쿼리파라미터).
3. 워크플로를 **활성화(Active)** 하세요.
4. 각 웹훅 노드를 열어서 Production URL을 확인하세요. 보통
   `https://<n8n 호스트>/webhook/repeat-study-new-get` 형태입니다. 이 중 `/webhook/` 앞부분
   (`https://<n8n 호스트>`)이 `app.js`/`admin.js`의 `CONFIG.N8N_BASE`에 들어갈 값이에요.

## 3. app.js / admin.js 설정값 반영

`나의취향`/`품질관리` 프로젝트에서 쓰시던 레일웨이 n8n 호스트(`primary-production-a6fa.up.railway.app`)를
`CONFIG.N8N_BASE`에 미리 넣어뒀습니다. 이 세션(클라우드 샌드박스)에서는 네트워크 정책상 이 호스트로
접속 테스트를 할 수가 없어서(같은 호스트의 이미 살아있는 다른 웹훅으로도 연결 실패), 실제로 맞는 값인지
끝까지 확인은 못 했어요. 워크플로 임포트/활성화 후 웹훅 노드의 Production URL이 아래 값과 다르면
직접 바꿔주세요.

```js
const CONFIG = {
  N8N_BASE: 'https://primary-production-a6fa.up.railway.app/webhook',
  ...
};
```

## 4. GitHub Pages 배포

새로 만드신 `jayunsu22/mystudy` 저장소(현재 README.md 1개뿐인 빈 저장소)에 이 폴더를 push합니다.
Claude는 이 세션에서 GitHub 푸시 인증 수단이 없어서(gh CLI 미인증, 이 폴더에 연결된 원격 환경도 GitHub
인증이 없음), 아래 명령을 사용자 PC의 터미널(PowerShell 등, 평소 github.com에 push하시던 그 환경)에서
직접 실행해주셔야 해요.

```powershell
cd "D:\n8n_반복학습\반복학습앱"
git init
git add .
git commit -m "init: 반복학습 앱 (음성 학습 + 화면 확인 + n8n 백엔드)"
git branch -M main
git remote add origin https://github.com/jayunsu22/mystudy.git
git push -u origin main --force
```

> `mystudy` 저장소에는 지금 자동 생성된 README.md 1개만 있어서(실제 내용 없음) `--force`로 덮어써도
> 잃을 게 없습니다. 이후로는 그냥 `git push`만 하시면 돼요.

1. 저장소 Settings → Pages → Source를 `main` 브랜치 `/ (root)`로 설정.
2. 몇 분 후 `https://jayunsu22.github.io/mystudy/` (음성 학습)과
   `https://jayunsu22.github.io/mystudy/admin.html` (화면 확인)로 접속 가능.
3. 휴대폰(Android 권장, Chrome)에서 `index.html` 주소를 홈 화면에 추가해두면 앱처럼 바로 실행 가능.
   음성인식은 `https` 또는 `localhost`에서만 동작하므로, 실제 사용은 배포 후 접속해서 테스트해주세요.

## 5. 캐시버스팅

`admin.js`/`admin_style.css`/`app.js`/`style.css`/`srs-utils.js` 중 하나라도 고쳐서 push할 때마다,
그 파일을 불러오는 HTML의 `?v=YYYYMMDD` 값을 그날 날짜로 갱신해주세요 (품질관리/나의취향 프로젝트와 동일한
규칙 — 안 그러면 휴대폰 브라우저가 예전 파일을 계속 씁니다).

## 6. 사용 흐름

1. 채팅에서 Claude에게 공부한 내용 URL/텍스트를 준다 → Claude가 카드를 만들어 Airtable에 저장.
2. `admin.html`에서 카드가 잘 만들어졌는지 확인 (필요하면 수정/삭제).
3. 출근길엔 `index.html` 열고 "신규학습" 시작 → 음성으로 진행.
4. 퇴근길엔 같은 앱에서 "복습" 시작 → 음성으로 진행. 세션 끝나면 자료별 반복 통계를 음성으로 알려줌.

## 7. 안전 관련 주의사항

- 안전을 위해 시작 버튼은 반드시 정차 중에 눌러주세요. 이후 진행은 음성으로만 하면 됩니다.
- iOS Safari는 연속 음성인식 지원이 불안정합니다. Android + Chrome을 권장합니다.
- 스피커 소리를 마이크가 다시 인식해 오작동할 수 있어, 블루투스 핸즈프리(에코 캔슬링 지원)나 이어폰
  마이크 사용을 권장합니다.
- 답을 못 알아들어도 8초 정도 지나면 자동으로 다음으로 넘어가도록 만들어 두어, 운전 중 앱이 멈춰있지
  않도록 했습니다.
