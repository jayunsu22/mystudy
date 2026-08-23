/* 레일웨이에 이미 떠 있는 n8n 인스턴스(나의취향/품질관리 프로젝트와 공유)를 그대로 씁니다.
   워크플로 임포트 후 웹훅 Production URL이 이 값과 다르면 여기를 실제 값으로 바꿔주세요. */
const CONFIG = {
  N8N_BASE: 'https://primary-production-a6fa.up.railway.app/webhook',
  MATERIALS_GET_PATH: '/repeat-study-materials-get',
  CARDS_GET_PATH: '/repeat-study-cards-get',
  CARD_UPDATE_PATH: '/repeat-study-card-update'
};

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
  const res = await fetchWithTimeout(`${CONFIG.N8N_BASE}${path}`, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

let materials = [];
let allCards = [];
let currentMaterialId = null;

const el = { app: document.getElementById('app') };

function renderLoading() {
  el.app.innerHTML = `<div class="loading">불러오는 중...</div>`;
}

async function loadAll() {
  renderLoading();
  try {
    const [materialsData, cardsData] = await Promise.all([
      callWebhook(CONFIG.MATERIALS_GET_PATH, { method: 'GET' }),
      callWebhook(CONFIG.CARDS_GET_PATH, { method: 'GET' })
    ]);
    materials = materialsData.materials || [];
    allCards = cardsData.cards || [];
    renderMaterialList();
  } catch (e) {
    el.app.innerHTML = `<div class="empty-state">서버에 연결하지 못했어요.<br>admin.js 상단 CONFIG.N8N_BASE 값을 확인해주세요.</div>`;
    showToast('불러오기 실패', 'error');
  }
}

function renderMaterialList() {
  currentMaterialId = null;
  if (!materials.length) {
    el.app.innerHTML = `<div class="empty-state">아직 등록된 학습자료가 없어요.<br>채팅에서 Claude에게 URL이나 텍스트를 주면 여기 나타나요.</div>`;
    return;
  }
  const rows = materials.map(m => `
    <div class="material-card" data-id="${m.material_id}">
      <div class="material-title">${m.title}</div>
      <div class="material-stats">
        <span class="badge">카드 ${m.card_count}개</span>
        ${m.new_count > 0 ? `<span class="badge new">신규 ${m.new_count}개</span>` : ''}
        총 <b>${m.total_reviews}회</b> 반복${m.last_reviewed_date ? ` · 최근 ${SrsUtilsFormatDate(m.last_reviewed_date)}` : ' · 아직 복습 전'}
      </div>
    </div>
  `).join('');
  el.app.innerHTML = rows;
  el.app.querySelectorAll('.material-card').forEach(card => {
    card.addEventListener('click', () => renderCardList(card.dataset.id));
  });
}

function SrsUtilsFormatDate(dateStr) {
  if (window.SrsUtils && window.SrsUtils.formatDateKo) return window.SrsUtils.formatDateKo(dateStr);
  return dateStr;
}

function renderCardList(materialId) {
  currentMaterialId = materialId;
  const material = materials.find(m => m.material_id === materialId);
  const cards = allCards.filter(c => c.material_id === materialId);

  const rows = cards.map(c => `
    <div class="card-row" data-id="${c.id}">
      <span class="badge ${c.stage === '신규' ? 'new' : ''}">${c.stage}</span>
      <span class="badge">${c.card_type}</span>
      ${!c.active ? '<span class="badge">비활성</span>' : ''}
      <div class="field-label" style="margin-top:8px;">질문</div>
      <textarea rows="2" data-field="question">${c.question || ''}</textarea>
      <div class="field-label">모범답안</div>
      <textarea rows="1" data-field="model_answer">${c.model_answer || ''}</textarea>
      <div class="field-label">힌트</div>
      <input type="text" data-field="hint" value="${(c.hint || '').replace(/"/g, '&quot;')}" />
      <div class="row-actions">
        <button class="btn-save" data-action="save">저장</button>
        <button class="btn-delete" data-action="delete">삭제</button>
      </div>
    </div>
  `).join('');

  el.app.innerHTML = `
    <button class="back-btn" id="backBtn">◀ 자료 목록으로</button>
    <div class="material-title" style="margin-bottom:14px;">${material ? material.title : ''} (${cards.length}개 카드)</div>
    ${cards.length ? rows : '<div class="empty-state">이 자료에 연결된 카드가 없어요.</div>'}
  `;

  document.getElementById('backBtn').addEventListener('click', () => { loadAll(); });
  el.app.querySelectorAll('.card-row').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('[data-action="save"]').addEventListener('click', () => saveCard(id, row));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteCard(id));
  });
}

async function saveCard(id, row) {
  const question = row.querySelector('[data-field="question"]').value.trim();
  const model_answer = row.querySelector('[data-field="model_answer"]').value.trim();
  const hint = row.querySelector('[data-field="hint"]').value.trim();
  if (!question || !model_answer) {
    showToast('질문과 모범답안은 비워둘 수 없어요.', 'error');
    return;
  }
  try {
    await callWebhook(CONFIG.CARD_UPDATE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id, question, model_answer, hint })
    });
    showToast('저장했어요.', 'success');
    const card = allCards.find(c => c.id === id);
    if (card) { card.question = question; card.model_answer = model_answer; card.hint = hint; }
  } catch (e) {
    showToast('저장 실패, 다시 시도해주세요.', 'error');
  }
}

async function deleteCard(id) {
  if (!confirm('이 카드를 삭제할까요? 되돌릴 수 없어요.')) return;
  try {
    await callWebhook(CONFIG.CARD_UPDATE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id })
    });
    allCards = allCards.filter(c => c.id !== id);
    showToast('삭제했어요.', 'success');
    renderCardList(currentMaterialId);
  } catch (e) {
    showToast('삭제 실패, 다시 시도해주세요.', 'error');
  }
}

loadAll();
