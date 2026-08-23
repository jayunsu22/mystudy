# 학습 화면 개선 (일시중지/정답선공개/속도조절/실시간캡션/다음확인) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `index.html`/`app.js`/`style.css`로 만든 음성 학습 앱(신규학습·복습)에 일시정지, 정답 선공개 후 숨기기, 말속도 4단계, 실시간 인식 캡션, 피드백 후 "다음으로 넘어갈까요?" 확인을 추가한다.

**Architecture:** 전부 프론트엔드(순수 HTML/CSS/바닐라 JS) 변경. `srs-utils.js`의 스케줄링 로직과 n8n/Airtable 백엔드는 그대로. `runLearningLoop`/`runReviewLoop`를 "카드 하나를 반복 가능한 안쪽 루프"로 재구성해 REPEAT 명령이 SRS 스케줄 상태를 건드리지 않고 같은 카드를 온전히 재생하게 한다.

**Tech Stack:** Web Speech API (`SpeechSynthesis`/`SpeechRecognition`), 바닐라 JS, `localStorage`.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-23-learning-screen-improvements-design.md` (이 계획은 그 문서를 그대로 구현한다. 세부 불일치 시 스펙이 우선).
- 대상 파일은 `index.html`, `style.css`, `app.js` 세 개뿐. `srs-utils.js`, `n8n_workflow.json`, `admin.html`/`admin.js`, Airtable은 변경 금지.
- `index.html`의 `?v=` 캐시버스팅 값은 이 작업이 끝나는 마지막 커밋에서 한 번만 `20260823`으로 올린다 (여러 번 올리지 않음 — 프로젝트 관례상 배포 직전에 한 번).
- 브라우저 음성 API(SpeechSynthesis/SpeechRecognition)는 Node 테스트 대상이 아니다(`tests/srs-utils.test.js`만 자동화 테스트 존재, 이번 작업과 무관). 각 태스크는 로컬 정적 서버로 실제 Chrome에서 수동 검증한다:
  ```bash
  cd "D:\n8n_반복학습\반복학습앱"
  python -m http.server 8000
  ```
  그 다음 Chrome에서 `http://localhost:8000/index.html` 접속 (음성인식은 `file://`에서 안 되고 `localhost`/`https`에서만 동작하므로 반드시 로컬 서버 경유). 마이크 권한 허용 프롬프트가 뜨면 허용.
- 백엔드(n8n `https://primary-production-a6fa.up.railway.app`, Airtable)는 이미 정상 동작 확인됨 — 실제 데이터로 종단 테스트 가능.
- 커밋 메시지는 한국어, `git commit`은 로컬에서 실행 가능(이미 확인됨). `git push`는 이 세션의 auto-mode 분류기가 막으므로 각 태스크에서 push하지 않는다 — 마지막에 사용자가 직접 push.

---

## Task 1: 마크업/스타일 — 일시정지 버튼, 정답/속도버튼 스타일, 캐시버스팅

**Files:**
- Modify: `index.html`
- Modify: `style.css`

**Interfaces:**
- Produces: `#btnPause` 버튼 엘리먼트 (Task 5에서 `el.btnPause`로 참조), `.answer`/`.rate-row`/`.rate-btn`/`.rate-btn.active`/`.footer-controls button.paused` CSS 클래스 (Task 2/4/5의 JS가 이 클래스명을 그대로 사용).

- [ ] **Step 1: `index.html`의 footer-controls에 일시정지 버튼 추가**

`index.html`에서 다음 블록을 찾는다:

```html
  <div class="footer-controls" id="footerControls" style="display:none;">
    <button id="btnRepeat">🔁 반복</button>
    <button id="btnNext">⏭ 다음</button>
    <button id="btnStop" class="stop">⏹ 종료</button>
  </div>
```

다음으로 교체:

```html
  <div class="footer-controls" id="footerControls" style="display:none;">
    <button id="btnRepeat">🔁 반복</button>
    <button id="btnNext">⏭ 다음</button>
    <button id="btnPause">⏸ 일시정지</button>
    <button id="btnStop" class="stop">⏹ 종료</button>
  </div>
```

- [ ] **Step 2: `index.html`의 `?v=` 캐시버스팅 값 갱신**

`style.css?v=20260822` → `style.css?v=20260823`
`srs-utils.js?v=20260822` → `srs-utils.js?v=20260823`
`app.js?v=20260822` → `app.js?v=20260823`

(파일 상단 `<link>` 태그 1곳, 하단 `<script>` 태그 2곳, 총 3곳)

- [ ] **Step 3: `style.css`에 새 클래스 추가**

파일 맨 끝(`.toast.show.error{...}` 다음 줄)에 추가:

```css
.answer{ font-size:20px; font-weight:700; color:var(--accent); background:#132038; padding:10px 16px; border-radius:12px; width:100%; }
.rate-row{ display:flex; gap:6px; justify-content:center; margin-bottom:4px; }
.rate-btn{ background:#1c2740; color:var(--muted); border:1px solid #2a3a5c; border-radius:10px; padding:6px 10px; font-size:12px; cursor:pointer; }
.rate-btn.active{ background:var(--accent); color:#04182b; border-color:var(--accent); font-weight:700; }
.footer-controls button.paused{ background:#332a1a; border-color:#5c4a2a; color:var(--warn); }
```

- [ ] **Step 4: 육안 확인**

로컬 서버로 `index.html`을 열어 홈 화면이 이전과 동일하게 보이는지 확인 (아직 JS가 이 버튼들을 안 쓰므로 기능 변화는 없음, 콘솔에 에러 없는지만 확인).

- [ ] **Step 5: 커밋**

```bash
cd "D:\n8n_반복학습\반복학습앱"
git add index.html style.css
git commit -m "feat: 일시정지 버튼 마크업, 정답/속도버튼 스타일, 캐시버스팅 20260823

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: 말 속도 4단계 버튼

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: Task 1의 `.rate-row`/`.rate-btn`/`.rate-btn.active` 클래스.
- Produces: 전역 `speechRate`(number) — Task 4/5의 `speak()` 호출이 이 값을 그대로 씀. `rateButtonsHtml()` 함수 — Task 4가 두 템플릿에서 재사용.

- [ ] **Step 1: 속도 상태 추가**

`app.js`에서 다음 블록을 찾는다 (`/* ============ 상태 ============ */` 바로 아래):

```js
/* ============ 상태 ============ */
let mode = 'HOME'; // HOME | NEW | REVIEW
let recognizing = false;
```

다음으로 교체 (한 줄 추가):

```js
/* ============ 상태 ============ */
let mode = 'HOME'; // HOME | NEW | REVIEW
let recognizing = false;
const RATE_OPTIONS = [0.7, 0.85, 1.0, 1.15];
let speechRate = parseFloat(localStorage.getItem('repeatStudySpeechRate')) || 0.85;
```

- [ ] **Step 2: `speak()`가 고정 rate 대신 `speechRate` 사용**

`app.js`에서 찾는다:

```js
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || 'ko-KR';
    u.rate = 0.98;
```

다음으로 교체:

```js
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || 'ko-KR';
    u.rate = speechRate;
```

- [ ] **Step 3: 속도 버튼 HTML 생성 헬퍼 추가**

`app.js`에서 `answerLangFor` 함수 바로 뒤(`/* ============ 홈 화면 ============ */` 바로 위)에 추가:

```js
function rateButtonsHtml() {
  return `<div class="rate-row">${RATE_OPTIONS.map(r =>
    `<button class="rate-btn${r === speechRate ? ' active' : ''}" data-rate="${r}">${r}x</button>`
  ).join('')}</div>`;
}
```

- [ ] **Step 4: 두 카드 템플릿 맨 위에 속도 버튼 삽입**

`renderLearningView`에서 찾는다:

```js
  el.card.innerHTML = `
    <div class="phase-tag new">🌱 신규학습 · ${phaseLabel}</div>
```

다음으로 교체:

```js
  el.card.innerHTML = `
    ${rateButtonsHtml()}
    <div class="phase-tag new">🌱 신규학습 · ${phaseLabel}</div>
```

`renderReviewView`에서 찾는다:

```js
  el.card.innerHTML = `
    <div class="phase-tag review">🔁 복습 · ${reviewIndex + 1}/${reviewQueue.length}</div>
```

다음으로 교체:

```js
  el.card.innerHTML = `
    ${rateButtonsHtml()}
    <div class="phase-tag review">🔁 복습 · ${reviewIndex + 1}/${reviewQueue.length}</div>
```

- [ ] **Step 5: 속도 버튼 클릭 이벤트 위임 추가**

`app.js` 맨 아래 `/* ============ 이벤트 바인딩 ============ */` 섹션, `el.startNewBtn.addEventListener(...)` 바로 앞에 추가:

```js
el.card.addEventListener('click', (e) => {
  const btn = e.target.closest('.rate-btn');
  if (!btn) return;
  speechRate = parseFloat(btn.dataset.rate);
  localStorage.setItem('repeatStudySpeechRate', String(speechRate));
  el.card.querySelectorAll('.rate-btn').forEach((b) => {
    b.classList.toggle('active', parseFloat(b.dataset.rate) === speechRate);
  });
});
```

(`el.card`에 위임하는 이유: `renderLearningView`/`renderReviewView`가 매 카드마다 `innerHTML`을 통째로 새로 그리므로, 버튼 각각에 리스너를 다는 대신 절대 재생성되지 않는 `el.card` 자체에 한 번만 리스너를 달아야 함.)

- [ ] **Step 6: 수동 검증**

로컬 서버로 열고 "신규학습" 시작 → 카드 화면 상단에 속도 버튼 4개(0.7x/0.85x/1.0x/1.15x) 표시, 기본 0.85x가 강조돼 있는지 확인. 다른 속도 버튼 클릭 → 강조 이동 + 다음 발화(피드백 등)가 눈에 띄게 빨라지거나 느려지는지 확인. 페이지 새로고침 후 다시 신규학습 시작 → 마지막에 고른 속도가 그대로 강조돼 있는지 확인(localStorage 유지).

- [ ] **Step 7: 커밋**

```bash
cd "D:\n8n_반복학습\반복학습앱"
git add app.js
git commit -m "feat: 말 속도 4단계 버튼 (0.7x/0.85x/1.0x/1.15x, localStorage 저장)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: 실시간 인식 캡션

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: 없음 (독립적인 `listenOnce()` 내부 변경).
- Produces: `#heardText`가 듣는 도중 `듣는 중: "..."`로 실시간 갱신됨 (Task 4/5는 이 동작을 그대로 상속, 별도 인터페이스 없음).

- [ ] **Step 1: interim 결과 받도록 설정 변경**

`app.js`에서 찾는다:

```js
if (SR) {
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;
}
```

다음으로 교체:

```js
if (SR) {
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
}
```

- [ ] **Step 2: `onresult` 핸들러를 interim/final로 분기**

`listenOnce()` 안에서 찾는다:

```js
    recognition.onresult = (e) => finish({ text: e.results[0][0].transcript.trim(), error: null });
    recognition.onerror = (e) => finish({ text: '', error: e.error });
    recognition.onend = () => finish({ text: '', error: 'ended' });
```

다음으로 교체:

```js
    recognition.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      const transcript = res[0].transcript.trim();
      if (res.isFinal) {
        finish({ text: transcript, error: null });
      } else {
        const heardEl = document.getElementById('heardText');
        if (heardEl) heardEl.textContent = `듣는 중: "${transcript}"`;
      }
    };
    recognition.onerror = (e) => finish({ text: '', error: e.error });
    recognition.onend = () => finish({ text: '', error: 'ended' });
```

- [ ] **Step 3: 수동 검증**

신규학습이나 복습 시작 → 질문에 답할 때 천천히 말하면서 화면의 회색 박스(`#heardText`)가 말하는 도중에도 "듣는 중: ..."으로 계속 갱신되는지 확인. 다 말하고 나면 기존처럼 `내가 말한 것: "..."`로 고정되는지 확인. 발음이 이상하게 인식되면 실시간으로 바로 보여서 확인 가능한지 체크.

- [ ] **Step 4: 커밋**

```bash
cd "D:\n8n_반복학습\반복학습앱"
git add app.js
git commit -m "feat: 음성인식 실시간 캡션 표시 (interimResults)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: 정답 선공개 + "다음으로 넘어갈까요?" 확인 (두 학습 루프 재구성)

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: Task 2의 `rateButtonsHtml()`, Task 3이 반영된 `listenOnce()`.
- Produces: `teachAndPrompt(card, introText)` — Promise<void>, 질문 발화 → 정답 공개+발화 → 정답 숨김+"따라 말해보세요" 발화까지 수행. `confirmAdvance()` — Promise<'NEXT'|'REPEAT'|'STOP'>, "다음으로 넘어갈까요?" 묻고 응답을 분류. Task 5가 이 두 함수 및 재구성된 루프를 그대로 사용(수정하지 않음).

- [ ] **Step 1: 두 카드 템플릿에 `#answerText` 추가**

`renderLearningView`에서 찾는다:

```js
    <div class="question">${card.question}</div>
    <div class="hint">${card.hint || ''}</div>
    <div class="heard" id="heardText"></div>
```

다음으로 교체 (이 패턴이 `renderLearningView`, `renderReviewView` 두 곳 모두에 동일하게 존재 — **두 곳 다** 교체):

```js
    <div class="question">${card.question}</div>
    <div class="hint">${card.hint || ''}</div>
    <div class="answer" id="answerText" style="display:none;"></div>
    <div class="heard" id="heardText"></div>
```

- [ ] **Step 2: `matchCommand()`에 "넘어가자" 추가**

`app.js`에서 찾는다:

```js
function matchCommand(text) {
  const t = (text || '').toLowerCase();
  if (/그만|정지|멈춰|종료|stop|quit|exit/.test(t)) return 'STOP';
  if (/반복|다시|again|repeat/.test(t)) return 'REPEAT';
  if (/다음|next|skip|모르겠|패스/.test(t)) return 'NEXT';
  return null;
}
```

다음으로 교체:

```js
function matchCommand(text) {
  const t = (text || '').toLowerCase();
  if (/그만|정지|멈춰|종료|stop|quit|exit/.test(t)) return 'STOP';
  if (/반복|다시|again|repeat/.test(t)) return 'REPEAT';
  if (/다음|next|skip|모르겠|패스|넘어가/.test(t)) return 'NEXT';
  return null;
}
```

- [ ] **Step 3: `teachAndPrompt()` / `confirmAdvance()` 추가**

`app.js`에서 `renderStatus()` 함수 바로 뒤, `answerLangFor()` 함수 바로 앞에 추가:

```js
async function teachAndPrompt(card, introText) {
  if (introText) {
    await speak(introText, 'ko-KR');
  }
  await speak(card.question, 'ko-KR');
  const answerEl = document.getElementById('answerText');
  if (answerEl) { answerEl.textContent = card.model_answer; answerEl.style.display = 'block'; }
  await speak(`정답은 ${card.model_answer}입니다.`, 'ko-KR');
  if (answerEl) { answerEl.style.display = 'none'; answerEl.textContent = ''; }
  await speak('따라 말해보세요.', 'ko-KR');
}

async function confirmAdvance() {
  await speak('다음으로 넘어갈까요?', 'ko-KR');
  renderStatus('listening');
  const { text, error } = await listenOnce('ko-KR', CONFIG.ANSWER_TIMEOUT_MS);
  dlog(`다음 확인 응답: "${text}"` + (error ? ` (에러: ${error})` : ''));
  const cmd = matchCommand(text);
  if (cmd === 'STOP') return 'STOP';
  if (cmd === 'REPEAT') return 'REPEAT';
  return 'NEXT';
}
```

- [ ] **Step 4: `runLearningLoop()` 전체 교체**

`app.js`에서 `async function runLearningLoop() {` 부터 그 함수의 닫는 `}`까지(바로 다음 줄이 `/* ============ 복습 (SM-2) ============ */` 주석) 통째로 다음으로 교체:

```js
async function runLearningLoop() {
  while (true) {
    const action = SrsUtils.pickNextAction(learningQueue, Date.now());

    if (action.type === 'done') {
      await speak(`오늘 신규학습 끝났어요. ${sessionStats.graduated}개 배워서 오늘 저녁 복습에 올라갈 거예요. 수고하셨어요!`, 'ko-KR');
      goHome();
      return;
    }

    if (action.type === 'wait') {
      renderStatus('idle');
      const secs = Math.ceil(action.waitMs / 1000);
      document.getElementById('statusLine').querySelector('.status-text').textContent = `다음 재확인까지 약 ${secs}초 남음 (⏹ 종료로 복습모드로 넘어갈 수 있어요)`;
      await new Promise((resolve) => { waitTimer = setTimeout(resolve, Math.min(action.waitMs, 5000)); });
      continue;
    }

    const item = action.item;
    const card = item.card;
    if (card.material_title) sessionStats.materialTitles.add(card.material_title);
    const isIntroduce = action.type === 'introduce';
    if (isIntroduce) item.introduced = true;

    let repeatThisCard = true;
    while (repeatThisCard) {
      repeatThisCard = false;

      if (isIntroduce) {
        renderLearningView(card, '처음 배우기');
        renderStatus('speaking');
        dlog(`신규 소개: ${card.question}`);
        await teachAndPrompt(card, null);
      } else {
        renderLearningView(card, `재확인 ${item.stepIndex}/${SrsUtils.STEP_INTERVALS_MIN.length - 1}`);
        renderStatus('speaking');
        dlog(`신규 재확인: ${card.question}`);
        await teachAndPrompt(card, '다시 확인할게요.');
      }

      renderStatus('listening');
      const { text, error } = await listenOnce(answerLangFor(card), CONFIG.ANSWER_TIMEOUT_MS);
      document.getElementById('heardText').textContent = text ? `내가 말한 것: "${text}"` : '(응답을 듣지 못했어요)';
      dlog(`답변: "${text}"` + (error ? ` (에러: ${error})` : ''));

      const cmd = matchCommand(text);
      if (cmd === 'STOP') { await speak('신규학습을 종료할게요.', 'ko-KR'); goHome(); return; }

      let result;
      try {
        result = await callWebhook(CONFIG.GRADE_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(SrsUtils.buildGradePayload({ card, phase: '신규', mode: 'VOICE', userAnswer: text }))
        });
      } catch (e) { repeatThisCard = true; continue; }

      sessionStats.total++;
      if (result.correct) sessionStats.correct++;

      const fbEl = document.getElementById('feedbackText');
      fbEl.style.display = 'block';
      fbEl.className = 'feedback ' + (result.correct ? 'correct' : 'incorrect');
      fbEl.textContent = result.feedback_ko;
      const pronEl = document.getElementById('pronTip');
      if (result.pronunciation_tip) {
        pronEl.style.display = 'block';
        pronEl.textContent = `🗣️ ${result.pronunciation_tip}`;
      } else {
        pronEl.style.display = 'none';
      }

      renderStatus('speaking');
      let feedbackToSpeak = result.feedback_ko;
      if (result.pronunciation_tip) feedbackToSpeak += ` ${result.pronunciation_tip}`;
      await speak(feedbackToSpeak, 'ko-KR');

      const advance = await confirmAdvance();
      if (advance === 'STOP') { await speak('신규학습을 종료할게요.', 'ko-KR'); goHome(); return; }
      if (advance === 'REPEAT') { repeatThisCard = true; continue; }

      SrsUtils.recordLearningResult(item, !!result.correct, Date.now());
      if (item.graduated) {
        sessionStats.graduated++;
        dlog(`졸업: ${card.question}`);
        callWebhook(CONFIG.GRADUATE_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card_id: card.id })
        }).catch(() => {}); // 실패해도 학습 흐름은 계속
        await speak('이 표현은 오늘 저녁 복습에서 다시 만나요!', 'ko-KR');
      }
    }
  }
}
```

- [ ] **Step 5: `runReviewLoop()` 전체 교체**

`app.js`에서 `async function runReviewLoop() {` 부터 그 함수의 닫는 `}`까지(바로 다음 줄이 `async function finishReview() {`) 통째로 다음으로 교체:

```js
async function runReviewLoop() {
  while (reviewIndex < reviewQueue.length) {
    const card = reviewQueue[reviewIndex];
    if (card.material_title) sessionStats.materialTitles.add(card.material_title);

    let repeatThisCard = true;
    while (repeatThisCard) {
      repeatThisCard = false;
      renderReviewView(card);
      renderStatus('speaking');
      dlog(`복습 질문 (${reviewIndex + 1}/${reviewQueue.length}): ${card.question}`);
      await teachAndPrompt(card, null);

      renderStatus('listening');
      const { text, error } = await listenOnce(answerLangFor(card), CONFIG.ANSWER_TIMEOUT_MS);
      document.getElementById('heardText').textContent = text ? `내가 말한 것: "${text}"` : '(응답을 듣지 못했어요)';
      dlog(`답변: "${text}"` + (error ? ` (에러: ${error})` : ''));

      const cmd = matchCommand(text);
      if (cmd === 'STOP') { await speak('복습을 종료할게요. 안전 운전하세요.', 'ko-KR'); await finishReview(); return; }
      if (cmd === 'REPEAT') { repeatThisCard = true; continue; }
      if (cmd === 'NEXT') { break; }

      let result;
      try {
        result = await callWebhook(CONFIG.GRADE_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(SrsUtils.buildGradePayload({ card, phase: '복습', mode: 'VOICE', userAnswer: text }))
        });
      } catch (e) { repeatThisCard = true; continue; }

      sessionStats.total++;
      if (result.correct) sessionStats.correct++;

      const fbEl = document.getElementById('feedbackText');
      fbEl.style.display = 'block';
      fbEl.className = 'feedback ' + (result.correct ? 'correct' : 'incorrect');
      fbEl.textContent = result.feedback_ko;
      const pronEl = document.getElementById('pronTip');
      if (result.pronunciation_tip) {
        pronEl.style.display = 'block';
        pronEl.textContent = `🗣️ ${result.pronunciation_tip}`;
      } else {
        pronEl.style.display = 'none';
      }

      renderStatus('speaking');
      let feedbackToSpeak = result.feedback_ko;
      if (result.pronunciation_tip) feedbackToSpeak += ` ${result.pronunciation_tip}`;
      await speak(feedbackToSpeak, 'ko-KR');

      const advance = await confirmAdvance();
      if (advance === 'STOP') { await speak('복습을 종료할게요. 안전 운전하세요.', 'ko-KR'); await finishReview(); return; }
      if (advance === 'REPEAT') { repeatThisCard = true; continue; }
    }
    reviewIndex++;
  }
  await finishReview();
}
```

- [ ] **Step 6: 수동 검증 — 신규학습**

"신규학습" 시작 → 카드가 뜨면: (1) 한국어 질문 음성, (2) 화면에 영어 정답이 나타나며 "정답은 ~입니다" 음성, (3) 영어가 사라지고 "따라 말해보세요" 음성, (4) 듣기 시작. 아무 답이나 말하고 채점 피드백을 들은 뒤 "다음으로 넘어갈까요?" 음성이 나오는지 확인. "반복"이라고 말하면 같은 카드가 (1)부터 다시 재생되는지, "넘어가자"라고 말하면 다음 카드로 넘어가는지 확인.

- [ ] **Step 7: 수동 검증 — 복습**

오늘 복습 카드가 있는 상태에서 "복습" 시작 → 동일하게 정답 선공개→숨김→따라말하기 순서 확인, 피드백 후 "다음으로 넘어갈까요?" → "반복"/"넘어가자" 분기 확인. 복습 중 답변 대신 바로 "그만"이라고 말하면 세션이 정상 종료(통계 안내 음성 포함)되는지 확인.

- [ ] **Step 8: 커밋**

```bash
cd "D:\n8n_반복학습\반복학습앱"
git add app.js
git commit -m "feat: 정답 선공개 후 숨기기 + 피드백 후 다음/반복 확인 (신규학습·복습 공통)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: 일시정지/재개

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: Task 1의 `#btnPause` 엘리먼트, Task 3이 반영된 `listenOnce()`의 `onend` 핸들러, Task 4가 재구성한 학습/복습 루프(변경 없이 그대로 사용 — pause는 `speak()`/`listenOnce()` 레벨에서 가로채므로 루프 코드는 pause를 몰라도 됨).
- Produces: 없음 (최종 태스크).

- [ ] **Step 1: 일시정지 상태 변수 추가**

`app.js`에서 Task 2가 추가한 블록 바로 뒤에 추가:

```js
const RATE_OPTIONS = [0.7, 0.85, 1.0, 1.15];
let speechRate = parseFloat(localStorage.getItem('repeatStudySpeechRate')) || 0.85;
let isPaused = false;
let pendingResumeListen = false;
```

- [ ] **Step 2: `el` 객체에 `btnPause` 추가**

`app.js`에서 찾는다:

```js
  btnStop: document.getElementById('btnStop'),
  voiceHint: document.getElementById('voiceHint'),
```

다음으로 교체:

```js
  btnStop: document.getElementById('btnStop'),
  btnPause: document.getElementById('btnPause'),
  voiceHint: document.getElementById('voiceHint'),
```

- [ ] **Step 3: `renderStatus()`에 'paused' 종류 추가**

`app.js`에서 찾는다:

```js
function renderStatus(kind) {
  const statusEl = document.getElementById('statusLine');
  if (!statusEl) return;
  const dot = statusEl.querySelector('.status-dot');
  dot.className = 'status-dot' + (kind === 'idle' ? '' : ' ' + kind);
  statusEl.querySelector('.status-text').textContent =
    kind === 'listening' ? '듣고 있어요...' : kind === 'speaking' ? '말하는 중...' : '대기 중';
}
```

다음으로 교체:

```js
function renderStatus(kind) {
  const statusEl = document.getElementById('statusLine');
  if (!statusEl) return;
  const dot = statusEl.querySelector('.status-dot');
  dot.className = 'status-dot' + (kind === 'idle' || kind === 'paused' ? '' : ' ' + kind);
  statusEl.querySelector('.status-text').textContent =
    kind === 'listening' ? '듣고 있어요...' :
    kind === 'speaking' ? '말하는 중...' :
    kind === 'paused' ? '일시정지됨' : '대기 중';
}
```

- [ ] **Step 4: `listenOnce()`의 `onend`가 일시정지 중단을 구분하도록 수정**

`app.js`에서 찾는다 (Task 3에서 만든 상태):

```js
    recognition.onerror = (e) => finish({ text: '', error: e.error });
    recognition.onend = () => finish({ text: '', error: 'ended' });
```

다음으로 교체:

```js
    recognition.onerror = (e) => finish({ text: '', error: e.error });
    recognition.onend = () => {
      if (isPaused) return; // 일시정지로 인한 중단 — 재개 시 recognition.start()로 이어감, 여기서 끝내지 않음
      finish({ text: '', error: 'ended' });
    };
```

- [ ] **Step 5: `goHome()`에서 일시정지 상태 초기화**

`app.js`에서 찾는다:

```js
function goHome() {
  mode = 'HOME';
  clearTimeout(waitTimer);
  el.footer.style.display = 'none';
```

다음으로 교체:

```js
function goHome() {
  mode = 'HOME';
  clearTimeout(waitTimer);
  isPaused = false;
  pendingResumeListen = false;
  if (el.btnPause) { el.btnPause.textContent = '⏸ 일시정지'; el.btnPause.classList.remove('paused'); }
  el.footer.style.display = 'none';
```

- [ ] **Step 6: 일시정지 버튼 클릭 핸들러 추가**

`app.js`의 이벤트 바인딩 섹션에서 찾는다:

```js
el.btnNext.addEventListener('click', () => { if (mode === 'REVIEW') reviewIndex++; });
el.btnStop.addEventListener('click', async () => {
```

다음으로 교체 (사이에 pause 핸들러 삽입):

```js
el.btnNext.addEventListener('click', () => { if (mode === 'REVIEW') reviewIndex++; });
el.btnPause.addEventListener('click', () => {
  if (!isPaused) {
    isPaused = true;
    if (synth.speaking) synth.pause();
    if (recognizing) {
      pendingResumeListen = true;
      try { recognition.abort(); } catch (e) {}
      recognizing = false;
    }
    el.btnPause.textContent = '▶ 계속';
    el.btnPause.classList.add('paused');
    renderStatus('paused');
  } else {
    isPaused = false;
    el.btnPause.textContent = '⏸ 일시정지';
    el.btnPause.classList.remove('paused');
    if (synth.paused) synth.resume();
    if (pendingResumeListen) {
      pendingResumeListen = false;
      try {
        recognition.start();
        recognizing = true;
        renderStatus('listening');
      } catch (e) {}
    }
  }
});
el.btnStop.addEventListener('click', async () => {
```

- [ ] **Step 7: 수동 검증 — 말하는 중 일시정지**

신규학습 시작 → TTS가 질문을 말하는 도중 "⏸ 일시정지" 클릭 → 음성이 그 자리에서 즉시 멈추는지 확인 (버튼은 "▶ 계속"으로 바뀜, 상태줄 "일시정지됨"). "▶ 계속" 클릭 → 멈췄던 지점부터 이어서 말하는지 확인.

- [ ] **Step 8: 수동 검증 — 듣는 중 일시정지**

"듣고 있어요..." 상태에서 "⏸ 일시정지" 클릭 → 마이크가 꺼지는지 확인. "▶ 계속" 클릭 → 같은 질문에 대해 마이크가 다시 켜져서("듣고 있어요...") 정상적으로 답을 받는지 확인 (앱이 멈추거나 다음 카드로 잘못 넘어가지 않아야 함).

- [ ] **Step 9: 수동 검증 — 종료 후 재시작**

일시정지 상태에서 "⏹ 종료" 클릭 → 정상 종료되는지, 홈 화면으로 돌아온 뒤 다시 "신규학습" 시작했을 때 일시정지 버튼이 "⏸ 일시정지"(정상 상태)로 보이는지 확인 (이전 세션의 paused 상태가 새 세션에 남아있지 않아야 함).

- [ ] **Step 10: 커밋**

```bash
cd "D:\n8n_반복학습\반복학습앱"
git add app.js
git commit -m "feat: 일시정지/재개 버튼 (TTS pause/resume, 듣기 중단 후 재시작)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## 최종: 사용자가 직접 push

전 태스크 완료 후, 사용자 터미널(PowerShell)에서:

```bash
cd "D:\n8n_반복학습\반복학습앱"
git push origin main
```
