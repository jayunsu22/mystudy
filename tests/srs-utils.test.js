const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createLearningQueue,
  recordLearningResult,
  pickNextAction,
  formatDateKo,
  buildGradePayload,
  STEP_INTERVALS_MIN
} = require('../srs-utils.js');

test('새 큐는 모든 카드를 introduce 대상으로 시작한다', () => {
  const queue = createLearningQueue([{ id: 'a' }, { id: 'b' }]);
  const action = pickNextAction(queue, 1000);
  assert.equal(action.type, 'introduce');
  assert.equal(action.item.card.id, 'a');
});

test('4번 연속 정답이면 졸업한다', () => {
  const queue = createLearningQueue([{ id: 'a' }]);
  const item = queue[0];
  let now = 0;
  for (let i = 0; i < STEP_INTERVALS_MIN.length; i++) {
    item.introduced = true;
    recordLearningResult(item, true, now);
    now += 20 * 60 * 1000; // 시간 충분히 흐른 것으로 가정
  }
  assert.equal(item.graduated, true);
  assert.equal(pickNextAction(queue, now).type, 'done');
});

test('오답이면 졸업하지 않고 30초 뒤 재시도로 예약된다', () => {
  const queue = createLearningQueue([{ id: 'a' }]);
  const item = queue[0];
  item.introduced = true;
  recordLearningResult(item, false, 1000);
  assert.equal(item.graduated, false);
  assert.equal(item.stepIndex, 0);
  assert.equal(item.nextDueAt, 1000 + 30000);
});

test('아직 시간이 안 된 카드만 있으면 wait을 반환한다', () => {
  const queue = createLearningQueue([{ id: 'a' }]);
  const item = queue[0];
  item.introduced = true;
  item.nextDueAt = 5000;
  const action = pickNextAction(queue, 1000);
  assert.equal(action.type, 'wait');
  assert.equal(action.waitMs, 4000);
});

test('reconfirm은 introduce보다 우선한다', () => {
  const queue = createLearningQueue([{ id: 'a' }, { id: 'b' }]);
  queue[0].introduced = true;
  queue[0].nextDueAt = 500;
  const action = pickNextAction(queue, 1000);
  assert.equal(action.type, 'reconfirm');
  assert.equal(action.item.card.id, 'a');
});

test('formatDateKo는 YYYY-MM-DD를 한국어 날짜로 바꾼다', () => {
  assert.equal(formatDateKo('2026-08-22'), '2026년 8월 22일');
  assert.equal(formatDateKo(''), '');
});

test('buildGradePayload는 복습 단계에서만 SM-2 상태값을 포함한다', () => {
  const card = { id: 'rec1', question: 'Q', model_answer: 'A', ease_factor: 2.5, interval_days: 3, times_reviewed: 2 };
  const newPayload = buildGradePayload({ card, phase: '신규', mode: 'VOICE', userAnswer: 'x' });
  assert.equal(newPayload.ease_factor, undefined);
  const reviewPayload = buildGradePayload({ card, phase: '복습', mode: 'VOICE', userAnswer: 'x' });
  assert.equal(reviewPayload.ease_factor, 2.5);
  assert.equal(reviewPayload.interval_days, 3);
});
