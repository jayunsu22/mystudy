/* ============ 설정 ============
   레일웨이에 이미 떠 있는 n8n 인스턴스(나의취향/품질관리 프로젝트와 공유)를 그대로 씁니다.
   워크플로 임포트 후 웹훅 Production URL이 이 값과 다르면 여기를 실제 값으로 바꿔주세요. */
const CONFIG = {
  N8N_BASE: 'https://primary-production-a6fa.up.railway.app/webhook',
  NEW_GET_PATH: '/repeat-study-new-get',
  REVIEW_GET_PATH: '/repeat-study-review-get',
  GRADE_PATH: '/repeat-study-grade',
  GRADUATE_PATH: '/repeat-study-graduate',
  MATERIALS_GET_PATH: '/repeat-study-materials-get',
  MAX_NEW_PER_SESSION: 8,
  ANSWER_TIMEOUT_MS: 8000
};

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
let mode = 'HOME'; // HOME | NEW | REVIEW
let recognizing = false;
const RATE_OPTIONS = [0.7, 0.85, 1.0, 1.15];
let speechRate = parseFloat(localStorage.getItem('repeatStudySpeechRate')) || 0.85;
let isPaused = false;
let pendingResumeListen = false;
let sessionStats = { correct: 0, total: 0, graduated: 0, materialTitles: new Set() };
let learningQueue = [];
let reviewQueue = [];
let reviewIndex = 0;
let waitTimer = null;

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
  statRow: document.getElementById('statRow'),
  startNewBtn: document.getElementById('startNewBtn'),
  startReviewBtn: document.getElementById('startReviewBtn'),
  footer: document.getElementById('footerControls'),
  btnRepeat: document.getElementById('btnRepeat'),
  btnNext: document.getElementById('btnNext'),
  btnStop: document.getElementById('btnStop'),
  btnPause: document.getElementById('btnPause'),
  voiceHint: document.getElementById('voiceHint'),
};

/* ============ 말하기/듣기 유틸 ============ */
function speak(text, lang, onend) {
  return new Promise((resolve) => {
    if (!synth) { onend && onend(); resolve(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || 'ko-KR';
    u.rate = speechRate;
    u.onend = () => { onend && onend(); resolve(); };
    u.onerror = () => { onend && onend(); resolve(); };
    synth.cancel();
    synth.speak(u);
  });
}

function listenOnce(lang, timeoutMs) {
  return new Promise((resolve) => {
    if (!recognition) { resolve({ text: '', error: 'no-speech-api' }); return; }
    let done = false;
    let timer = null;
    recognition.lang = lang || 'ko-KR';

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognizing = false;
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
    recognition.onend = () => {
      if (isPaused) return; // 일시정지로 인한 중단 — 재개 시 recognition.start()로 이어감, 여기서 끝내지 않음
      finish({ text: '', error: 'ended' });
    };

    try {
      recognition.start();
      recognizing = true;
      renderStatus('listening');
    } catch (err) {
      finish({ text: '', error: 'start-failed' });
      return;
    }

    timer = setTimeout(() => {
      try { recognition.stop(); } catch (e) {}
      finish({ text: '', error: 'timeout' });
    }, timeoutMs || CONFIG.ANSWER_TIMEOUT_MS);
  });
}

function matchCommand(text) {
  const t = (text || '').toLowerCase();
  if (/그만|정지|멈춰|종료|stop|quit|exit/.test(t)) return 'STOP';
  if (/반복|다시|again|repeat/.test(t)) return 'REPEAT';
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

function answerLangFor(card) {
  return card.card_type === 'VOCAB' ? 'en-US' : 'ko-KR';
}

function rateButtonsHtml() {
  return `<div class="rate-row">${RATE_OPTIONS.map(r =>
    `<button class="rate-btn${r === speechRate ? ' active' : ''}" data-rate="${r}">${r}x</button>`
  ).join('')}</div>`;
}

/* ============ 홈 화면 ============ */
async function loadHomeCounts() {
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

function goHome() {
  mode = 'HOME';
  clearTimeout(waitTimer);
  isPaused = false;
  pendingResumeListen = false;
  if (el.btnPause) { el.btnPause.textContent = '⏸ 일시정지'; el.btnPause.classList.remove('paused'); }
  el.footer.style.display = 'none';
  el.voiceHint.style.display = 'none';
  el.card.innerHTML = '';
  el.card.appendChild(el.home);
  el.home.style.display = 'block';
  renderDebugPanel();
  loadHomeCounts();
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

async function finishReview() {
  let summary = `오늘 복습 ${sessionStats.total}개 중 ${sessionStats.correct}개 맞혔어요.`;
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
el.startNewBtn.addEventListener('click', () => {
  if (!SR) { alert('이 브라우저는 음성인식을 지원하지 않아요. Android Chrome을 사용해주세요.'); }
  newLearningFlow();
});
el.startReviewBtn.addEventListener('click', () => {
  if (!SR) { alert('이 브라우저는 음성인식을 지원하지 않아요. Android Chrome을 사용해주세요.'); }
  reviewFlow();
});
el.btnRepeat.addEventListener('click', () => { /* 다음 루프에서 같은 카드가 다시 나올 때 자연히 처리됨 */ });
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
  await speak('세션을 종료할게요.', 'ko-KR');
  goHome();
});

/* ============ 초기화 ============ */
goHome();
