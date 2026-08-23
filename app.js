/* ============ 설정 ============
   레일웨이에 이미 떠 있는 n8n 인스턴스(나의취향/품질관리 프로젝트와 공유)를 그대로 씁니다.
   워크플로 임포트 후 웹훅 Production URL이 이 값과 다르면 여기를 실제 값으로 바꿔주세요. */
const CONFIG = {
  N8N_BASE: 'https://primary-production-a6fa.up.railway.app/webhook',
  NEW_GET_PATH: '/repeat-study-new-get',
  REVIEW_GET_PATH: '/repeat-study-review-get',
  GRADE_PATH: '/repeat-study-grade',
  GRADUATE_PATH: '/repeat-study-graduate',
  REVIEW_COMPLETE_PATH: '/repeat-study-review-complete', // 채점 없이 SM-2 스케줄만 넘기는 웹훅
  MATERIALS_GET_PATH: '/repeat-study-materials-get',
  CHAPTERS_GET_PATH: '/repeat-study-chapters-get', // 챕터(학습자료) 목록 조회
  CHAPTER_CARDS_GET_PATH: '/repeat-study-chapter-cards-get', // ?material_id= 로 특정 챕터의 문장 목록 조회
  MAX_NEW_PER_SESSION: 8,
  ANSWER_TIMEOUT_MS: 8000,
  DRILL_WAIT_MS: 10000, // 3번 듣고 따라하기 + 2번 회상하기, 각 스텝마다 조용히 기다리는 시간(마이크 안 켬)
  CHAPTER_REVIEW_WAIT_MS: 10000 // 챕터 셔플 복습에서 질문 듣고 조용히 대답해보는 대기 시간(마이크 안 켬)
};
// Gemini 채점(GRADE_PATH)은 지금 드릴에서 호출을 잠시 막아뒀습니다 — 운전 중 소음 때문에 인식/채점이 잘 안 돼서.
// 관련 코드(callWebhook(GRADE_PATH,...), buildGradePayload, teachAndPrompt/confirmAdvance)는 나중에 다시 쓸 수 있게 지우지 않고 남겨둠.
// SM-2 자동학습(신규학습/복습 큐, newLearningFlow/runLearningLoop/reviewFlow/runReviewLoop)은
// "챕터 선택 학습 + 셔플 복습"으로 완전히 대체되어 화면/버튼에서는 더 이상 쓰이지 않습니다.
// 관련 웹훅(NEW_GET_PATH 등)과 함수는 나중에 다시 쓸 수 있게 지우지 않고 남겨둠.

/* ============ fetch 공통 유틸 (나의취향/품질관리 프로젝트와 동일 패턴) ============ */
function showToast(message, type) {
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = `toast show ${type || ''}`;
  setTimeout(() => { toastEl.className = 'toast'; }, 3000);
}

function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function callWebhook(path, options) {
  try {
    const res = await fetchWithTimeout(`${CONFIG.N8N_BASE}${path}`, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    dlog(`웹훅 실패 (${path}): ${e}`);
    showToast('서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.', 'error');
    throw e;
  }
}

/* ============ 디버그 로그 ============ */
function dlog(msg) {
  const entry = new Date().toLocaleTimeString('ko-KR', { hour12: false }) + ' ' + msg;
  console.log('[repeat-study]', entry);
  try {
    const log = JSON.parse(localStorage.getItem('repeatStudyDebugLog') || '[]');
    log.push(entry);
    while (log.length > 40) log.shift();
    localStorage.setItem('repeatStudyDebugLog', JSON.stringify(log));
  } catch (e) {}
}
function renderDebugPanel() {
  const panelEl = document.getElementById('debugPanel');
  if (!panelEl) return;
  let log = [];
  try { log = JSON.parse(localStorage.getItem('repeatStudyDebugLog') || '[]'); } catch (e) {}
  panelEl.textContent = log.length ? log.join('\n') : '(아직 기록 없음)';
}

/* ============ 상태 ============ */
let mode = 'HOME'; // HOME | CHAPTER | CHAPTER_REVIEW | NEW(미사용) | REVIEW(미사용)
let recognizing = false;
let currentChapter = null; // { id, title } — 지금 들어가 있는 챕터
let chapterCards = [];
let chapterIndex = 0;
let chapterJumpIndex = null; // 드롭다운으로 다른 문장을 골랐을 때 다음에 진행할 인덱스
const RATE_OPTIONS = [0.7, 0.85, 1.0, 1.15];
const ENGLISH_RATE_MULTIPLIER = 0.7; // 영어 문장(정답)은 발음이 잘 들리도록 한국어 안내보다 항상 70% 속도로 재생
let speechRate = parseFloat(localStorage.getItem('repeatStudySpeechRate')) || 0.85;
let isPaused = false;
let pendingResumeListen = false;
let repeatRequested = false; // "반복"/"이전대화" 버튼으로 강제 반복 요청 시 true — speak()/listenOnce()가 이걸 보고 즉시 넘어감
let nextRequested = false; // "다음" 버튼으로 강제 진행 요청 시 true — 드릴/대기를 즉시 건너뛰고 다음 단계로
let sessionStats = { correct: 0, total: 0, graduated: 0, materialTitles: new Set() };
let learningQueue = [];
let reviewQueue = [];
let reviewIndex = 0;
let waitTimer = null;

// listenOnce()의 8초 타임아웃 타이머 — 일시정지 중에는 멈추고, 재개 시 남은 시간만큼만 다시 돌린다.
let listenTimerId = null;
let listenTimerArmedAt = null;
let listenTimerDurationMs = null;
let listenTimeoutCallback = null;

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis;
let recognition = null;
if (SR) {
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
}

const el = {
  card: document.getElementById('card'),
  home: document.getElementById('view-home'),
  chapterListWrap: document.getElementById('chapterListWrap'),
  statRow: document.getElementById('statRow'),
  startNewBtn: document.getElementById('startNewBtn'),
  startReviewBtn: document.getElementById('startReviewBtn'),
  footer: document.getElementById('footerControls'),
  btnRepeat: document.getElementById('btnRepeat'),
  btnNext: document.getElementById('btnNext'),
  btnPrevTurn: document.getElementById('btnPrevTurn'),
  btnStop: document.getElementById('btnStop'),
  btnPause: document.getElementById('btnPause'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnHome: document.getElementById('btnHome'),
  btnChapterReview: document.getElementById('btnChapterReview'),
  voiceHint: document.getElementById('voiceHint'),
};

/* ============ 말하기/듣기 유틸 ============ */
function speak(text, lang, onend) {
  return new Promise((resolve) => {
    if (repeatRequested || nextRequested) { onend && onend(); resolve(); return; } // 반복/다음 요청 시 남은 안내 문구는 건너뜀
    if (!synth) { onend && onend(); resolve(); return; }
    if (synth.paused) synth.resume(); // 일시정지 상태로 남아있으면 cancel()해도 새 발화가 밀릴 수 있음
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || 'ko-KR';
    u.rate = u.lang.toLowerCase().startsWith('en') ? speechRate * ENGLISH_RATE_MULTIPLIER : speechRate;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      onend && onend();
      resolve();
    };
    u.onend = finish;
    u.onerror = finish;
    // 버튼을 빠르게 연타해서 cancel()+speak()가 짧은 간격으로 겹치면, 일부 모바일 브라우저의 TTS 엔진이
    // onend/onerror를 아예 쏘지 않고 멈춰버리는 경우가 있다("다음"을 연타했더니 문장 읽다가 멈춤 버그).
    // 글자 수 기반 최대 대기시간을 넘기면 강제로 다음 단계로 진행시켜 앱 전체가 멈추는 걸 방지한다.
    const watchdogMs = Math.max(4000, text.length * 350) / (speechRate || 1);
    const watchdog = setTimeout(finish, watchdogMs);
    synth.cancel();
    synth.speak(u);
  });
}

/* listenOnce()의 타임아웃 타이머를 일시정지/재개와 맞물려 다루기 위한 헬퍼.
   recognition은 싱글턴이라 한 번에 하나의 listenOnce만 활성 상태라고 가정한다. */
function armListenTimer(durationMs) {
  clearTimeout(listenTimerId);
  listenTimerArmedAt = Date.now();
  listenTimerDurationMs = durationMs;
  listenTimerId = setTimeout(() => {
    listenTimerId = null;
    if (listenTimeoutCallback) listenTimeoutCallback();
  }, durationMs);
}

function pauseListenTimer() {
  if (listenTimerId === null) return;
  clearTimeout(listenTimerId);
  listenTimerId = null;
  const elapsed = Date.now() - listenTimerArmedAt;
  listenTimerDurationMs = Math.max(0, listenTimerDurationMs - elapsed);
}

function resumeListenTimer() {
  if (!listenTimeoutCallback) return; // 진행 중인 listenOnce가 없으면 아무것도 하지 않음
  armListenTimer(listenTimerDurationMs);
}

function clearListenTimer() {
  clearTimeout(listenTimerId);
  listenTimerId = null;
  listenTimerArmedAt = null;
  listenTimerDurationMs = null;
}

function listenOnce(lang, timeoutMs) {
  return new Promise((resolve) => {
    if (repeatRequested) { repeatRequested = false; resolve({ text: '반복', error: null }); return; }
    if (nextRequested) { nextRequested = false; resolve({ text: '다음', error: null }); return; }
    if (!recognition) { resolve({ text: '', error: 'no-speech-api' }); return; }
    let done = false;
    recognition.lang = lang || 'ko-KR';

    // onend/onerror/타임아웃 세 경로 모두 여기로 모인다 — 일시정지 중이면(재개 대기 중이면)
    // 어느 경로로도 절대 종료하지 않는다. 재개되면 recognition이 이어서 이벤트를 계속 쏘고,
    // 그때 isPaused/pendingResumeListen이 이미 false이므로 정상적으로 finish()된다.
    const finish = (result) => {
      if (isPaused && pendingResumeListen) return;
      if (done) return;
      done = true;
      clearListenTimer();
      listenTimeoutCallback = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognizing = false;
      if (repeatRequested) { repeatRequested = false; result = { text: '반복', error: null }; }
      else if (nextRequested) { nextRequested = false; result = { text: '다음', error: null }; }
      resolve(result);
    };

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

    try {
      recognition.start();
      recognizing = true;
      renderStatus('listening');
    } catch (err) {
      finish({ text: '', error: 'start-failed' });
      return;
    }

    listenTimeoutCallback = () => {
      try { recognition.stop(); } catch (e) {}
      finish({ text: '', error: 'timeout' });
    };
    armListenTimer(timeoutMs || CONFIG.ANSWER_TIMEOUT_MS);
  });
}

function matchCommand(text) {
  const t = (text || '').toLowerCase();
  if (/그만|정지|멈춰|종료|stop|quit|exit/.test(t)) return 'STOP';
  if (/반복|다시|again|repeat|지금/.test(t)) return 'REPEAT';
  if (/다음|next|skip|모르겠|패스|넘어가/.test(t)) return 'NEXT';
  return null;
}

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

async function teachAndPrompt(card, introText) {
  if (introText) {
    await speak(introText, 'ko-KR');
  }
  await speak(card.question, 'ko-KR');
  const answerEl = document.getElementById('answerText');
  if (answerEl) { answerEl.textContent = card.model_answer; answerEl.style.display = 'block'; }
  await speak(`정답은 ${card.model_answer}입니다.`, 'ko-KR');
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

/* 조용히 카운트다운만 하는 대기 — 마이크는 켜지 않는다(운전 중 소음으로 인식이 잘 안 돼서).
   "반복"/"다음" 버튼이 눌리면(repeatRequested/nextRequested) 즉시 끝난다. 일시정지 중엔 카운트가 멈춘다. */
function countdownWait(ms) {
  const statusEl = document.getElementById('statusLine');
  let remain = ms;
  return new Promise((resolve) => {
    const tick = () => {
      if (mode === 'HOME' || repeatRequested || nextRequested) { resolve(); return; } // 종료(홈으로) 시 즉시 대기 중단
      if (isPaused) { waitTimer = setTimeout(tick, 250); return; }
      if (statusEl) statusEl.querySelector('.status-text').textContent = `말해보세요... (${Math.max(0, Math.ceil(remain / 1000))}초)`;
      remain -= 250;
      if (remain <= 0) { resolve(); return; }
      waitTimer = setTimeout(tick, 250);
    };
    tick();
  });
}

/* 한 카드를 5단계로 연습: 영어 정답 3번 듣고 따라말하기 → 한국어 질문 2번 듣고 회상해서 답하기.
   각 스텝 사이엔 마이크 없이 DRILL_WAIT_MS만큼 조용히 기다림(사용자가 알아서 따라말함, 채점 안 함).
   "반복" 버튼이 눌리면 false를 반환(호출부가 같은 카드를 처음부터 다시 시작), "다음" 버튼이 눌리면
   남은 스텝을 건너뛰고 true를 반환(nextRequested는 그대로 켜진 채로 다음 confirmAdvanceThreeWay에서 소비됨). */
async function runCardDrill(card) {
  // 새 문장(카드)에 들어올 때는 항상 깨끗한 상태에서 시작 — 직전 카드에서 버튼 연타 등으로
  // repeatRequested/nextRequested가 남아있었더라도 여기서 확실히 초기화한다.
  repeatRequested = false;
  nextRequested = false;

  const answerEl = document.getElementById('answerText');
  if (answerEl) { answerEl.textContent = card.model_answer; answerEl.style.display = 'block'; }

  // 문장에 처음 진입할 때(또는 "반복"으로 처음부터 다시 시작할 때) 어떤 문장을 연습할지 먼저 안내.
  // card.question은 보통 "'실제 문장'를 영어로?" 형태라 따옴표 안의 순수 문장만 뽑아서 들려준다.
  const introMatch = /'([^']+)'/.exec(card.question || '');
  const introSentence = introMatch ? introMatch[1] : (card.question || '');
  renderStatus('speaking');
  await speak(`이번 문장은 '${introSentence}' 입니다. 잘 듣고 따라해 주세요.`, 'ko-KR');
  if (mode === 'HOME') return true; // 종료(홈으로) 시 즉시 중단
  if (repeatRequested) { repeatRequested = false; return false; }
  if (nextRequested) { return true; }

  const steps = [
    { text: card.model_answer, lang: 'en-US' },
    { text: card.model_answer, lang: 'en-US' },
    { text: card.model_answer, lang: 'en-US' },
    { text: card.question, lang: 'ko-KR' },
    { text: card.question, lang: 'ko-KR' }
  ];
  for (const step of steps) {
    renderStatus('speaking');
    await speak(step.text, step.lang);
    if (mode === 'HOME') return true;
    if (repeatRequested) { repeatRequested = false; return false; }
    if (nextRequested) { return true; }
    renderStatus('idle');
    await countdownWait(CONFIG.DRILL_WAIT_MS);
    if (mode === 'HOME') return true;
    if (repeatRequested) { repeatRequested = false; return false; }
    if (nextRequested) { return true; }
  }
  return true;
}

/* 드릴이 끝난 뒤 "다음 문장으로 넘어가도 될까요?"를 묻고, 응답을 3지(다음문장/지금문장/연습종료)로 분류.
   matchCommand()를 그대로 재사용 — "연습종료"는 이미 STOP 정규식의 "종료"에 걸리고,
   "지금문장"은 REPEAT 정규식에 추가한 "지금"에 걸린다. */
async function confirmAdvanceThreeWay() {
  await speak('다음 문장으로 넘어가도 될까요?', 'ko-KR');
  if (mode === 'HOME') return 'STOP'; // 종료(홈으로) 시 즉시 중단
  renderStatus('listening');
  const { text, error } = await listenOnce('ko-KR', CONFIG.ANSWER_TIMEOUT_MS);
  if (mode === 'HOME') return 'STOP';
  dlog(`다음 확인 응답: "${text}"` + (error ? ` (에러: ${error})` : ''));
  const cmd = matchCommand(text);
  if (cmd === 'STOP') return 'STOP';
  if (cmd === 'REPEAT') return 'REPEAT';
  return 'NEXT';
}

function answerLangFor(card) {
  return card.card_type === 'VOCAB' ? 'en-US' : 'ko-KR';
}

function rateButtonsHtml() {
  return `<div class="rate-row">${RATE_OPTIONS.map(r =>
    `<button class="rate-btn${r === speechRate ? ' active' : ''}" data-rate="${r}">${r}x</button>`
  ).join('')}</div>`;
}

/* ============ 홈 화면 (챕터 목록) ============ */
// 옛 SM-2 홈 화면 카운트(신규/복습 대기 개수)는 더 이상 화면에서 안 쓰지만, 나중을 위해 남겨둠.
async function loadHomeCounts() {
  if (!el.statRow) return;
  el.statRow.innerHTML = `<div class="stat-chip">불러오는 중...</div>`;
  try {
    const [newData, reviewData] = await Promise.all([
      callWebhook(CONFIG.NEW_GET_PATH, { method: 'GET' }),
      callWebhook(CONFIG.REVIEW_GET_PATH, { method: 'GET' })
    ]);
    const newCount = (newData.cards || []).length;
    const reviewCount = (reviewData.cards || []).length;
    el.statRow.innerHTML = `<div class="stat-chip">신규 대기 ${newCount}개</div><div class="stat-chip">복습 대기 ${reviewCount}개</div>`;
  } catch (e) {
    el.statRow.innerHTML = `<div class="stat-chip">서버 연결 안됨 — CONFIG.N8N_BASE 확인</div>`;
  }
}

/* 챕터(학습자료) 목록을 홈 화면에 불러온다. 챕터를 탭하면 enterChapter()로 들어간다. */
async function loadChapterList() {
  if (!el.chapterListWrap) return;
  el.chapterListWrap.innerHTML = `<div class="stat-chip">불러오는 중...</div>`;
  try {
    const data = await callWebhook(CONFIG.CHAPTERS_GET_PATH, { method: 'GET' });
    const chapters = data.chapters || [];
    if (!chapters.length) {
      el.chapterListWrap.innerHTML = `<div class="stat-chip">아직 등록된 챕터가 없어요</div>`;
      return;
    }
    el.chapterListWrap.innerHTML = chapters.map((ch) => `
      <button class="chapter-item" data-chapter-id="${ch.id}" data-chapter-title="${(ch.title || '').replace(/"/g, '&quot;')}">
        <span class="chapter-title">${ch.title}</span>
        <span class="chapter-count">${ch.card_count}개 문장 ›</span>
      </button>
    `).join('');
  } catch (e) {
    el.chapterListWrap.innerHTML = `<div class="stat-chip">서버 연결 안됨 — CONFIG.N8N_BASE 확인</div>`;
  }
}

function setPauseBtnLabel(icon, label) {
  if (!el.btnPause) return;
  el.btnPause.innerHTML = `<span class="fc-icon">${icon}</span><span class="fc-label">${label}</span>`;
}

function goHome() {
  mode = 'HOME';
  clearTimeout(waitTimer);
  isPaused = false;
  pendingResumeListen = false;
  repeatRequested = false;
  nextRequested = false;
  currentChapter = null;
  chapterCards = [];
  chapterIndex = 0;
  chapterJumpIndex = null;
  if (synth.paused) synth.resume(); // 일시정지 상태로 홈에 돌아가면 TTS 엔진이 계속 멈춰있지 않도록
  setPauseBtnLabel('⏸', '일시정지');
  if (el.btnPause) el.btnPause.classList.remove('paused');
  el.footer.style.display = 'none';
  el.voiceHint.style.display = 'none';
  if (el.btnChapterReview) el.btnChapterReview.style.display = 'none';
  el.card.innerHTML = '';
  el.card.appendChild(el.home);
  el.home.style.display = 'block';
  renderDebugPanel();
  loadChapterList();
}

/* ============ 챕터 선택 학습 + 셔플 복습 ============ */
/* 챕터에 들어가면 그 챕터의 문장 목록을 받아와서 첫 문장부터 순서대로 5단계 드릴 학습을 시작한다. */
async function enterChapter(chapter) {
  currentChapter = chapter;
  mode = 'CHAPTER';
  el.home.style.display = 'none';
  el.footer.style.display = 'none';
  el.card.innerHTML = `<div class="stat-chip">불러오는 중...</div>`;
  let data;
  try {
    data = await callWebhook(`${CONFIG.CHAPTER_CARDS_GET_PATH}?material_id=${encodeURIComponent(chapter.id)}`, { method: 'GET' });
  } catch (e) { goHome(); return; }

  chapterCards = data.cards || [];
  if (!chapterCards.length) {
    await speak(`${chapter.title} 챕터에 문장이 없어요.`, 'ko-KR');
    goHome();
    return;
  }
  chapterIndex = 0;
  chapterJumpIndex = null;
  if (el.btnChapterReview) el.btnChapterReview.style.display = 'inline-flex';
  el.footer.style.display = 'flex';
  el.voiceHint.style.display = 'block';
  await runChapterStudyLoop();
}

/* 드롭다운에서 문장을 직접 골랐을 때: 진행 중인 스텝을 "다음" 버튼과 같은 방식으로 끊고,
   다음 확인 단계에서 index+1이 아니라 고른 인덱스로 점프하게 한다. */
function jumpToChapterCard(newIndex) {
  if (mode !== 'CHAPTER' || newIndex === chapterIndex) return;
  chapterJumpIndex = newIndex;
  triggerNext();
}

function renderChapterStudyView(card, index) {
  const options = chapterCards.map((c, i) => {
    const m = /'([^']+)'/.exec(c.question || '');
    const label = m ? m[1] : (c.question || `문장 ${i + 1}`);
    return `<option value="${i}"${i === index ? ' selected' : ''}>${i + 1}. ${label}</option>`;
  }).join('');
  el.card.innerHTML = `
    <select id="chapterCardSelect" class="chapter-select">${options}</select>
    ${rateButtonsHtml()}
    <div class="phase-tag new">📖 ${currentChapter.title} · ${index + 1}/${chapterCards.length}</div>
    <div id="statusLine" class="status-line"><span class="status-dot"></span><span class="status-text">대기 중</span></div>
    <div class="question">${card.question}</div>
    <div class="hint">${card.hint || ''}</div>
    <div class="answer" id="answerText" style="display:none;"></div>
    <div class="heard" id="heardText"></div>
    <div class="feedback" id="feedbackText" style="display:none;"></div>
    <div class="pron-tip" id="pronTip" style="display:none;"></div>
  `;
  const selectEl = document.getElementById('chapterCardSelect');
  if (selectEl) {
    selectEl.addEventListener('change', () => { jumpToChapterCard(parseInt(selectEl.value, 10)); });
  }
}

async function runChapterStudyLoop() {
  while (chapterIndex < chapterCards.length) {
    const card = chapterCards[chapterIndex];
    let repeatThisCard = true;
    while (repeatThisCard) {
      repeatThisCard = false;
      renderChapterStudyView(card, chapterIndex);
      dlog(`챕터 학습 (${currentChapter.title} ${chapterIndex + 1}/${chapterCards.length}): ${card.question}`);

      const completed = await runCardDrill(card);
      if (mode === 'HOME') return;
      if (!completed) { repeatThisCard = true; continue; } // "반복" 버튼 — 이 문장 처음부터 다시

      const advance = await confirmAdvanceThreeWay();
      if (mode === 'HOME') return;
      if (advance === 'STOP') { await speak('학습을 종료할게요.', 'ko-KR'); goHome(); return; }
      if (advance === 'REPEAT') { repeatThisCard = true; continue; }
    }
    if (chapterJumpIndex !== null) { chapterIndex = chapterJumpIndex; chapterJumpIndex = null; }
    else { chapterIndex++; }
  }
  await speak(`${currentChapter.title} 챕터를 다 마쳤어요. 수고하셨어요!`, 'ko-KR');
  goHome();
}

/* 셔플 복습: 챕터 문장을 무작위로 섞어서, 문장마다
   "AI가 한국어로 질문 1번 말하기 → 10초 조용히 대기(그 사이에 소리내어 답해보기, 화면엔 정답 계속 표시)"를
   2회 반복한다. 마이크는 켜지 않는다(운전 중 소음 대비). */
function renderChapterReviewView(card, repIndex) {
  el.card.innerHTML = `
    <div class="phase-tag review">🔁 ${currentChapter.title} 복습 · ${repIndex + 1}/2</div>
    <div id="statusLine" class="status-line"><span class="status-dot"></span><span class="status-text">대기 중</span></div>
    <div class="question">${card.question}</div>
    <div class="answer" id="answerText" style="display:block;">${card.model_answer}</div>
    <div class="heard" id="heardText"></div>
  `;
}

/* true를 반환하면 "종료"로 전체 복습을 중단해야 한다는 뜻. */
async function runChapterReviewDrill(card) {
  const introMatch = /'([^']+)'/.exec(card.question || '');
  const sentence = introMatch ? introMatch[1] : (card.question || '');
  for (let rep = 0; rep < 2; rep++) {
    renderChapterReviewView(card, rep);
    renderStatus('speaking');
    await speak(`'${sentence}'를 영어로 말해보세요.`, 'ko-KR');
    if (mode === 'HOME') return true;
    if (repeatRequested) { repeatRequested = false; rep = -1; continue; } // 이 문장 2회부터 다시
    if (nextRequested) { nextRequested = false; return false; } // 이 문장 건너뛰고 다음 셔플 카드로
    renderStatus('idle');
    await countdownWait(CONFIG.CHAPTER_REVIEW_WAIT_MS);
    if (mode === 'HOME') return true;
    if (repeatRequested) { repeatRequested = false; rep = -1; continue; }
    if (nextRequested) { nextRequested = false; return false; }
  }
  return false;
}

async function startChapterReview() {
  if (mode !== 'CHAPTER' || !chapterCards.length) return;
  mode = 'CHAPTER_REVIEW';
  el.voiceHint.style.display = 'none';
  const shuffled = [...chapterCards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (const card of shuffled) {
    dlog(`챕터 셔플복습 (${currentChapter.title}): ${card.question}`);
    const stopRequested = await runChapterReviewDrill(card);
    if (mode === 'HOME') return;
    if (stopRequested) break;
  }
  if (mode === 'HOME') return;
  await speak(`${currentChapter.title} 복습을 마쳤어요. 수고하셨어요!`, 'ko-KR');
  goHome();
}

/* ============ 신규학습 (Pimsleur 식 그라데이션 리콜) ============ */
function renderLearningView(card, phaseLabel) {
  el.home.style.display = 'none';
  el.footer.style.display = 'flex';
  el.voiceHint.style.display = 'block';
  el.card.innerHTML = `
    ${rateButtonsHtml()}
    <div class="phase-tag new">🌱 신규학습 · ${phaseLabel}</div>
    <div class="subject-tag">${card.material_title || ''}</div>
    <div id="statusLine" class="status-line"><span class="status-dot"></span><span class="status-text">대기 중</span></div>
    <div class="question">${card.question}</div>
    <div class="hint">${card.hint || ''}</div>
    <div class="answer" id="answerText" style="display:none;"></div>
    <div class="heard" id="heardText"></div>
    <div class="feedback" id="feedbackText" style="display:none;"></div>
    <div class="pron-tip" id="pronTip" style="display:none;"></div>
  `;
}

async function newLearningFlow() {
  mode = 'NEW';
  el.footer.style.display = 'none';
  let data;
  try {
    data = await callWebhook(CONFIG.NEW_GET_PATH, { method: 'GET' });
  } catch (e) { goHome(); return; }

  const cards = (data.cards || []).slice(0, CONFIG.MAX_NEW_PER_SESSION);
  if (!cards.length) {
    await speak('오늘 새로 배울 카드가 없어요. 복습 모드를 이용해보세요.', 'ko-KR');
    goHome();
    return;
  }
  learningQueue = SrsUtils.createLearningQueue(cards);
  sessionStats = { correct: 0, total: 0, graduated: 0, materialTitles: new Set() };
  await runLearningLoop();
}

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

      renderLearningView(card, isIntroduce ? '처음 배우기' : `재확인 ${item.stepIndex}/${SrsUtils.STEP_INTERVALS_MIN.length - 1}`);
      dlog(`${isIntroduce ? '신규 소개' : '신규 재확인'}: ${card.question}`);

      const completed = await runCardDrill(card);
      if (!completed) { repeatThisCard = true; continue; } // "반복" 버튼 — 이 카드 드릴 처음부터 다시

      const advance = await confirmAdvanceThreeWay();
      if (advance === 'STOP') { await speak('신규학습을 종료할게요.', 'ko-KR'); goHome(); return; }
      if (advance === 'REPEAT') { repeatThisCard = true; continue; }

      // 채점을 안 하므로 항상 통과로 집계 — 드릴을 끝까지 마쳤다는 것 자체를 진행으로 침
      sessionStats.total++;
      sessionStats.correct++;
      SrsUtils.recordLearningResult(item, true, Date.now());
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

/* ============ 복습 (SM-2) ============ */
function renderReviewView(card) {
  el.home.style.display = 'none';
  el.footer.style.display = 'flex';
  el.voiceHint.style.display = 'block';
  el.card.innerHTML = `
    ${rateButtonsHtml()}
    <div class="phase-tag review">🔁 복습 · ${reviewIndex + 1}/${reviewQueue.length}</div>
    <div class="subject-tag">${card.material_title || ''}</div>
    <div id="statusLine" class="status-line"><span class="status-dot"></span><span class="status-text">대기 중</span></div>
    <div class="question">${card.question}</div>
    <div class="hint">${card.hint || ''}</div>
    <div class="answer" id="answerText" style="display:none;"></div>
    <div class="heard" id="heardText"></div>
    <div class="feedback" id="feedbackText" style="display:none;"></div>
    <div class="pron-tip" id="pronTip" style="display:none;"></div>
  `;
}

async function reviewFlow() {
  mode = 'REVIEW';
  el.footer.style.display = 'none';
  let data;
  try {
    data = await callWebhook(CONFIG.REVIEW_GET_PATH, { method: 'GET' });
  } catch (e) { goHome(); return; }

  reviewQueue = data.cards || [];
  reviewIndex = 0;
  sessionStats = { correct: 0, total: 0, graduated: 0, materialTitles: new Set() };

  if (!reviewQueue.length) {
    await speak('오늘 복습할 카드가 없어요. 잘하고 계세요!', 'ko-KR');
    goHome();
    return;
  }
  await runReviewLoop();
}

async function runReviewLoop() {
  while (reviewIndex < reviewQueue.length) {
    const card = reviewQueue[reviewIndex];
    if (card.material_title) sessionStats.materialTitles.add(card.material_title);

    let repeatThisCard = true;
    while (repeatThisCard) {
      repeatThisCard = false;
      renderReviewView(card);
      dlog(`복습 (${reviewIndex + 1}/${reviewQueue.length}): ${card.question}`);

      const completed = await runCardDrill(card);
      if (!completed) { repeatThisCard = true; continue; } // "반복" 버튼 — 이 카드 드릴 처음부터 다시

      const advance = await confirmAdvanceThreeWay();
      if (advance === 'STOP') { await speak('복습을 종료할게요. 안전 운전하세요.', 'ko-KR'); await finishReview(); return; }
      if (advance === 'REPEAT') { repeatThisCard = true; continue; }

      // 채점을 안 하므로 항상 통과로 집계하고, 무채점 전용 웹훅으로 SM-2 스케줄(다음복습일 등)만 갱신
      sessionStats.total++;
      sessionStats.correct++;
      callWebhook(CONFIG.REVIEW_COMPLETE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: card.id,
          ease_factor: card.ease_factor,
          interval_days: card.interval_days,
          times_reviewed: card.times_reviewed
        })
      }).catch(() => {}); // 실패해도 음성 흐름은 계속 — 다음 복습 때 스케줄이 그대로일 뿐
    }
    reviewIndex++;
  }
  await finishReview();
}

async function finishReview() {
  let summary = `오늘 복습 ${sessionStats.total}개 연습했어요.`;
  try {
    const materialsData = await callWebhook(CONFIG.MATERIALS_GET_PATH, { method: 'GET' });
    const touched = (materialsData.materials || []).filter(m => sessionStats.materialTitles.has(m.title));
    touched.forEach(m => {
      summary += ` ${m.title} 총 ${m.total_reviews}회 반복했어요.`;
    });
  } catch (e) { /* 통계 조회 실패해도 세션 마무리는 계속 */ }
  await speak(summary, 'ko-KR');
  goHome();
}

/* ============ 이벤트 바인딩 ============ */
el.card.addEventListener('click', (e) => {
  const btn = e.target.closest('.rate-btn');
  if (!btn) return;
  speechRate = parseFloat(btn.dataset.rate);
  localStorage.setItem('repeatStudySpeechRate', String(speechRate));
  el.card.querySelectorAll('.rate-btn').forEach((b) => {
    b.classList.toggle('active', parseFloat(b.dataset.rate) === speechRate);
  });
});
// 챕터 목록(홈 화면)에서 챕터 하나를 탭하면 그 챕터로 들어간다.
el.home.addEventListener('click', (e) => {
  const btn = e.target.closest('.chapter-item');
  if (!btn) return;
  if (!SR) { alert('이 브라우저는 음성인식을 지원하지 않아요. Android Chrome을 사용해주세요.'); }
  enterChapter({ id: btn.dataset.chapterId, title: btn.dataset.chapterTitle });
});
if (el.btnChapterReview) {
  el.btnChapterReview.addEventListener('click', () => { startChapterReview(); });
}
function interruptCurrentStep() {
  if (synth && synth.speaking) synth.cancel(); // 지금 말하던 안내는 여기서 끊기고, 이후 speak() 호출들은 전부 건너뜀
  if (recognizing) {
    try { recognition.abort(); } catch (e) {} // 듣던 중이면 종료시켜서 finish()가 바로 넘겨받게 함
  }
}
function triggerRepeat() {
  if (mode === 'HOME') return;
  if (repeatRequested) return; // 이미 처리 중인 반복 요청이 있으면 연타 무시(중복 트리거로 흐름이 꼬이는 것 방지)
  repeatRequested = true;
  nextRequested = false; // 반복이 우선
  interruptCurrentStep();
}
function triggerNext() {
  if (mode === 'HOME') return;
  if (nextRequested) return; // 이미 처리 중인 다음 요청이 있으면 연타 무시(중복 트리거로 흐름이 꼬이는 것 방지)
  nextRequested = true;
  repeatRequested = false; // 다음이 우선
  interruptCurrentStep();
}
el.btnRepeat.addEventListener('click', triggerRepeat);
el.btnPrevTurn.addEventListener('click', triggerRepeat); // "이전대화" = 직전 자리(같은 카드)를 처음부터 다시 듣기
el.btnNext.addEventListener('click', triggerNext);
el.btnRefresh.addEventListener('click', () => { location.reload(); });
el.btnHome.addEventListener('click', () => { goHome(); });
el.btnPause.addEventListener('click', () => {
  if (!isPaused) {
    isPaused = true;
    if (synth.speaking) synth.pause();
    if (recognizing) {
      pendingResumeListen = true;
      pauseListenTimer(); // 남은 타임아웃 시간을 기록하고 타이머는 멈춤 — 일시정지 중엔 절대 만료되지 않게
      try { recognition.abort(); } catch (e) {}
      recognizing = false;
    }
    setPauseBtnLabel('▶', '계속');
    el.btnPause.classList.add('paused');
    renderStatus('paused');
  } else {
    isPaused = false;
    setPauseBtnLabel('⏸', '일시정지');
    el.btnPause.classList.remove('paused');
    if (synth.paused) synth.resume();
    if (pendingResumeListen) {
      pendingResumeListen = false;
      try {
        recognition.start();
        recognizing = true;
        renderStatus('listening');
        resumeListenTimer(); // 일시정지 전에 남아있던 시간만큼만 다시 카운트다운
      } catch (e) {}
    } else {
      renderStatus(synth.speaking ? 'speaking' : 'idle');
    }
  }
});
el.btnStop.addEventListener('click', async () => {
  interruptCurrentStep(); // 진행 중이던 말하기/듣기를 즉시 끊어서 종료 반응이 느려지지 않게 함
  await speak('세션을 종료할게요.', 'ko-KR');
  goHome();
});

/* ============ 초기화 ============ */
goHome();
