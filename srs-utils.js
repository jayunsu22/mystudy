(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SrsUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Pimsleur 식 그라데이션 리콜: 즉시(0분) -> 1분 -> 5분 -> 15분, 4번 연속 통과하면 "졸업"(신규->복습 전환)
  const STEP_INTERVALS_MIN = [0, 1, 5, 15];
  const RETRY_INTERVAL_MS = 30 * 1000; // 오답 시 같은 단계에서 30초 후 재시도

  function createLearningItem(card) {
    return { card, stepIndex: 0, introduced: false, nextDueAt: 0, graduated: false };
  }

  function createLearningQueue(cards) {
    return cards.map(createLearningItem);
  }

  /**
   * 정답/오답 결과를 반영해 item을 갱신한다. graduated:true가 되면 이 아이템은 큐에서 제거하고
   * /repeat-study-graduate 웹훅을 호출해 서버(Airtable)에 신규->복습 전환을 기록해야 한다.
   */
  function recordLearningResult(item, correct, now) {
    now = now || Date.now();
    if (correct) {
      item.stepIndex += 1;
      if (item.stepIndex >= STEP_INTERVALS_MIN.length) {
        item.graduated = true;
      } else {
        item.nextDueAt = now + STEP_INTERVALS_MIN[item.stepIndex] * 60 * 1000;
      }
    } else {
      item.nextDueAt = now + RETRY_INTERVAL_MS;
    }
    return item;
  }

  /**
   * 다음에 뭘 해야 하는지 알려준다.
   * - {type:'introduce', item}  : 아직 안 보여준 새 카드를 처음 소개
   * - {type:'reconfirm', item}  : 이미 소개한 카드 중 재확인 시점이 된 것
   * - {type:'wait', waitMs}     : 지금은 할 게 없고 waitMs 후에 다시 확인해야 함
   * - {type:'done'}             : 큐에 남은 게 없음(전부 졸업)
   */
  function pickNextAction(queue, now) {
    now = now || Date.now();
    const remaining = queue.filter(i => !i.graduated);
    if (!remaining.length) return { type: 'done' };

    const due = remaining.filter(i => i.introduced && i.nextDueAt <= now).sort((a, b) => a.nextDueAt - b.nextDueAt);
    if (due.length) return { type: 'reconfirm', item: due[0] };

    const fresh = remaining.filter(i => !i.introduced);
    if (fresh.length) return { type: 'introduce', item: fresh[0] };

    const waiting = remaining.filter(i => i.introduced);
    const minDue = Math.min(...waiting.map(i => i.nextDueAt));
    return { type: 'wait', waitMs: Math.max(0, minDue - now) };
  }

  function formatDateKo(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${y}년 ${Number(m)}월 ${Number(d)}일`;
  }

  function buildGradePayload({ card, phase, mode, userAnswer }) {
    const payload = {
      card_id: card.id,
      phase,
      mode,
      question: card.question,
      model_answer: card.model_answer,
      user_answer: userAnswer || ''
    };
    if (phase === '복습') {
      payload.ease_factor = card.ease_factor;
      payload.interval_days = card.interval_days;
      payload.times_reviewed = card.times_reviewed;
    }
    return payload;
  }

  return {
    STEP_INTERVALS_MIN,
    RETRY_INTERVAL_MS,
    createLearningItem,
    createLearningQueue,
    recordLearningResult,
    pickNextAction,
    formatDateKo,
    buildGradePayload
  };
});
