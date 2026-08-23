# 학습 화면 개선 (일시중지 / 정답 선공개 / 속도조절 / 실시간 캡션 / 다음 확인)

## 배경

`index.html` + `app.js` + `style.css`로 만든 음성 학습 앱을 실제 차 안에서 써보면서 나온 요청 5가지.
대상은 신규학습(`runLearningLoop`)과 복습(`runReviewLoop`) 두 흐름 모두, `srs-utils.js`의 스케줄링 로직은 건드리지 않는다.

## 1. 일시중지 버튼

- 하단 `footer-controls`에 "⏸ 일시정지" 버튼 추가 (반복/다음/종료 옆).
- 상태: `let isPaused = false; let pendingResumeListen = false;`
- **말하는 중 일시정지**: `speechSynthesis.pause()` 호출. 버튼을 "▶ 계속"으로 바꿈. 다시 누르면 `speechSynthesis.resume()` — 웹 스피치 API가 발화 중간 지점부터 자연스럽게 이어서 재생하는 것을 그대로 활용(별도 상태 복원 로직 불필요).
- **듣는 중(마이크) 일시정지**: `recognition.abort()`로 인식만 멈추고, `listenOnce()`의 `finish()`를 호출하지 않는다 (Promise를 그대로 pending 상태로 둠). `pendingResumeListen = true`로 표시.
  - `listenOnce()`의 `onend` 핸들러는 "일시정지로 인한 종료"인지 구분해야 한다: `isPaused && pendingResumeListen`이면 `finish()`를 호출하지 않고 그냥 리턴.
  - 재개 시: `recognition.start()`를 다시 호출 (같은 `finish` 클로저가 여전히 `onresult`/`onerror`/`onend`에 바인딩되어 있으므로 그대로 이어짐). `pendingResumeListen = false`.
- 홈 화면(`mode === 'HOME'`)에서는 버튼 비활성화 또는 숨김.
- 일시정지 중에는 상태줄(`renderStatus`)에 "일시정지됨" 표시.

## 2. 정답 먼저 보여주고 "따라 말해보세요" 직전에 숨기기 — 전 단계 공통

신규학습 처음배우기 / 재확인, 복습 3곳 모두 동일한 순서로 통일한다 (지금은 재확인·복습이 정답을 전혀 안 알려주고 바로 테스트하는 구조인데, 이번 요청으로 3곳 다 "먼저 보여주고 지운 뒤 테스트"로 바뀜 — 사용자 확인 완료).

새 공통 헬퍼 `teachAndPrompt(card, introText)`:
1. `introText`(단계별 안내 문구, 예: 없음 / "다시 확인할게요." / 없음) + `card.question` 발화.
2. `#answerText` 표시 + `정답은 ${card.model_answer}입니다.` 발화.
3. `#answerText` 숨김 + `따라 말해보세요.` 발화.
4. 리턴 (호출부에서 `listenOnce()` 진행).

`renderLearningView` / `renderReviewView` 템플릿에 `<div class="answer" id="answerText" style="display:none;"></div>` 한 줄 추가 (질문/힌트 아래, `heard` 위).

`runLearningLoop`의 `introduce`/재확인 분기, `runReviewLoop`의 질문 분기에서 기존 `await speak(...)` 호출을 `await teachAndPrompt(card, introText)`로 교체.

## 3. 말 속도 4단계 버튼

- 값: `0.7 / 0.85 / 1.0 / 1.15`, 기본 `0.85`.
- `localStorage`에 `repeatStudySpeechRate` 키로 저장/복원.
- 카드 화면 상단(`phase-tag` 아래) 작은 버튼 4개 — 선택된 속도는 강조 스타일(`.rate-btn.active`).
- `speak()`의 `u.rate = 0.98` 고정값을 전역 `speechRate` 변수로 교체.
- 버튼 클릭 시 즉시 `speechRate` 갱신 + localStorage 저장 + 강조 갱신. 진행 중인 발화에는 영향 없음(다음 발화부터 적용 — Web Speech API는 발화 중 rate 변경 불가).

## 4. 실시간 인식 텍스트

- `recognition.interimResults = true`로 변경.
- `listenOnce()`의 `onresult` 핸들러를 최종/중간 결과 분기 처리:
  ```js
  recognition.onresult = (e) => {
    const res = e.results[e.results.length - 1];
    const transcript = res[0].transcript.trim();
    if (res.isFinal) {
      finish({ text: transcript, error: null });
    } else {
      updateHeardLive(transcript); // #heardText를 "듣는 중: ..." 으로 즉시 갱신
    }
  };
  ```
- 최종 결과가 오면 기존처럼 `내가 말한 것: "..."`로 고정 표시.
- 신규학습/복습 양쪽 `listenOnce()` 호출 모두 자동으로 적용됨 (공용 함수라 별도 분기 불필요).

## 5. 피드백 후 "다음으로 넘어갈까요?" 확인

채점 결과 피드백(`feedback_ko` + 발음팁)을 말한 **직후**, 바로 다음 루프로 안 넘어가고 확인 단계를 추가한다.

새 헬퍼 `confirmAdvance()` → `'NEXT' | 'REPEAT' | 'STOP'` 반환:
1. `다음으로 넘어갈까요?` 발화.
2. `listenOnce()`로 응답 대기 (기존 `CONFIG.ANSWER_TIMEOUT_MS` 재사용).
3. 기존 `matchCommand()`를 확장해서 판정:
   - `NEXT` 계열 정규식에 `넘어가자|넘어가`를 추가 (`/다음|next|skip|모르겠|패스|넘어가/`).
   - `REPEAT` 계열(`반복|다시|again|repeat`)은 그대로 재사용.
   - `STOP`(`그만|정지|멈춰|종료|stop|quit|exit`)도 그대로 유지 — 여기서도 "그만"이라고 하면 세션 종료.
   - 못 알아듣거나 타임아웃(`error`가 있고 명령어 매칭 안 됨) → `NEXT`로 간주 (기존 타임아웃-진행 패턴과 동일).

`runLearningLoop` / `runReviewLoop`에서 피드백 발화 직후 `confirmAdvance()` 호출:
- `STOP` → 기존 종료 처리로 분기.
- `REPEAT` → **같은 카드**에 대해 `teachAndPrompt()`부터 다시 실행 (SRS 스케줄 갱신 없이 반복만, 학습 큐/복습 인덱스는 그대로 유지).
- `NEXT` → 기존처럼 다음 루프 진행 (신규학습은 `SrsUtils.recordLearningResult` 이후 다음 `pickNextAction`, 복습은 `reviewIndex++`).

## 변경 파일

- `index.html` — `#answerText`, 속도 버튼 4개, 일시정지 버튼 마크업 추가. `?v=` 캐시버스팅 값 오늘 날짜(`20260823`)로 갱신.
- `style.css` — `.answer`, `.rate-btn`(+`.active`), `#pauseBtn` 관련 스타일 추가.
- `app.js` — `teachAndPrompt()`, `confirmAdvance()`, 일시정지 상태/핸들러, 속도 상태/버튼 핸들러, `listenOnce()` interim 처리, `matchCommand()` 정규식 확장.
- `srs-utils.js` / `n8n_workflow.json` / Airtable — 변경 없음 (전부 프론트엔드 화면·음성 로직 범위).

## 테스트

`tests/srs-utils.test.js`는 이번 변경과 무관 (SRS 스케줄링 로직 그대로). 이번 변경은 브라우저 음성 API(SpeechSynthesis/SpeechRecognition) 의존이라 자동화 단위테스트 대상이 아니며, 실제 기기(Chrome/Android)에서 수동 테스트로 검증한다:
- 일시정지: 말하는 중/듣는 중 각각 눌러서 정상 재개되는지.
- 정답 선공개→숨김: 신규/재확인/복습 3곳 모두 화면에 영어가 잠깐 떴다가 "따라 말해보세요" 시점에 사라지는지.
- 속도 4버튼: 선택 강조 + 새로고침 후에도 유지되는지.
- 실시간 캡션: 말하는 도중 텍스트가 갱신되는지.
- "넘어가자"/"반복" 음성 명령이 의도대로 분기되는지.
