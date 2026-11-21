// back.js (Node.js CommonJS 기준)

// 커스텀 히든 룰 풀 (구체적인 룰 목록은 여기에서 추가/수정)
const HIDDEN_RULES_POOL = [
  {
    id: 'EXODIA',
    name: '엑조디아',
    desc: '흑백 조커, 컬러 조커, 스페이드 A, 스페이드 K, 스페이드 Q 5장이 동시에 모이면 즉시 승리',
    timing: 'instant',
    check: p => {
      const hasBlackJoker = p.hand.some(c => c.type === 'joker' && c.jokerType === 'black');
      const hasColorJoker = p.hand.some(c => c.type === 'joker' && c.jokerType === 'color');
      const hasSpadeA = p.hand.some(c => c.shape === 'spade' && c.number === 1);
      const hasSpadeK = p.hand.some(c => c.shape === 'spade' && c.number === 13);
      const hasSpadeQ = p.hand.some(c => c.shape === 'spade' && c.number === 12);
      return hasBlackJoker && hasColorJoker && hasSpadeA && hasSpadeK && hasSpadeQ;
    }
  },
  {
    id: 'FOUR_OF_A_KIND',
    name: '포카드 수집가',
    desc: '4가지 문양(♠, ◆, ♥, ♣)이 모두 모인 동일한 숫자 카드 4장을 보유하면 즉시 승리',
    timing: 'instant',
    check: p => {
      const shapesByNum = {};
      for (const c of p.hand) {
        if (c.type === 'normal' && c.number >= 1 && c.number <= 13) {
          if (!shapesByNum[c.number]) shapesByNum[c.number] = new Set();
          shapesByNum[c.number].add(c.shape);
          if (shapesByNum[c.number].size === 4) return true;
        }
      }
      return false;
    }
  },
  {
    id: 'ZERO_PLAY_STREAK',
    name: '침묵의 턴',
    desc: '자신의 턴에 카드를 내지 않고 덱에서 1장을 뽑아 턴을 넘기는 행동을 연속 4턴 성공하면 즉시 승리',
    timing: 'instant',
    check: p => p.zeroPlayStreak >= 4
  },
  {
    id: 'MEGA_COUNTER',
    name: '대반격의 서막',
    desc: '누적 공격 페널티가 8장 이상 쌓인 상태에서 공격 카드나 방어 아이템으로 막아내거나 넘기면 즉시 승리',
    timing: 'trigger',
    event: 'mega_counter',
    check: (p, eventData) => eventData.playerId === p.id && eventData.prevAttackStack >= 8
  },
  {
    id: 'SNIPER_FINISH',
    name: '완벽한 저격',
    desc: '내가 낸 공격 카드(2, A, 조커)나 공격형 아이템으로 인해 직전 또는 다음 플레이어의 손패가 정확히 13장이 되면 즉시 승리',
    timing: 'trigger',
    event: 'sniper_finish',
    check: (p, eventData) => (
      eventData.attackerId === p.id &&
      eventData.victimId !== p.id &&
      eventData.victimHandLength === 13
    )
  },
  {
    id: 'PACIFIST',
    name: '평화주의자',
    desc: '연속 7턴 동안 공격 카드(A, 조커, 2)를 내지 않으면 즉시 승리',
    timing: 'instant',
    check: p => p.pacifistStreak >= 7
  },
  {
    id: 'PROPHET',
    name: '예언가',
    desc: '게임 시작 시 지목한 플레이어가 가장 먼저 원카드를 외치면 즉시 승리',
    timing: 'trigger',
    event: 'onecard_defend',
    check: (p, eventData) => Boolean(
      eventData.isFirstDefend &&
      p.ruleTargetId &&
      (eventData.callerId === p.ruleTargetId || eventData.callerSocketId === p.ruleTargetId)
    )
  },
  {
    id: 'STRAIGHT',
    name: '스트레이트',
    desc: '문양 무관하게 연속된 숫자 5장 이상이 모이면 즉시 승리 (A-2-3-4-5, 10-J-Q-K-A 인정)',
    timing: 'instant',
    check: p => {
      const numSet = new Set();
      for (const c of p.hand) {
        if (c.type === 'normal' && c.number >= 1 && c.number <= 13) {
          numSet.add(c.number);
          if (c.number === 1) numSet.add(14);
        }
      }
      if (numSet.size < 5) return false;
      const sorted = Array.from(numSet).sort((a, b) => a - b);
      let streak = 1;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === sorted[i - 1] + 1) {
          streak++;
          if (streak >= 5) return true;
        } else {
          streak = 1;
        }
      }
      return false;
    }
  }
];

class OneCardGame {
  constructor(playerList, customRules = {}) {

    this.customRules = {
      turnTimeLimit: Number(customRules.turnTimeLimit) || 15,
      startingHandCount: Number(customRules.startingHandCount) || 7,
      bankruptcyLimit: Number(customRules.bankruptcyLimit) || 15,
      enableHiddenRules: Boolean(customRules.enableHiddenRules)
    };

    this.playerzone = playerList.map((p, idx) => ({
      socketId: p.socketId,
      id: `P${idx + 1}`,
      name: p.name,
      hand: [],
      onecard: false,
      onecardCalled: false,
      isEliminated: false,
      hiddenRule: null,
      ruleTargetId: null,
      everReachedTen: false,
      highRiskFailed: false,
      zeroPlayStreak: 0,
      pacifistStreak: 0
    }));

    this.deck = [];
    this.submitzoneCards = [];
    this.currentturn = 0;
    this.attackstack = 0;
    this.lastAttackerId = null;
    this.firstOneCardCallerId = null;
    this.undirection = false; // false: 시계, true: 반시계
    this.currentshape = null;
    this.turnTimeLimit = 15;

    this.init();
  }

  // 순수 데이터 형태 카드 생성
  createCard() {
    const shapes = ['spade', 'heart', 'diamond', 'clover'];
    shapes.forEach(shape => {
      for (let num = 1; num <= 13; num++) {
        this.deck.push({ type: 'normal', shape, number: num });
      }
    });
    this.deck.push({ type: 'joker', shape: 'joker', number: 99, jokerType: 'black', name: '흑조커' });
    this.deck.push({ type: 'joker', shape: 'joker', number: 99, jokerType: 'color', name: '컬조커' });

    // 아이템 카드 각 2장씩 추가
    // 아이템 카드 number는 100번부터 시작
    for (let i = 0; i < 2; i++) {
      this.deck.push({ type: 'item', shape: 'item', number: 100, itemType: 'fast_forward', name: '빨리감기' });
      this.deck.push({ type: 'item', shape: 'item', number: 101, itemType: 'reflect', name: '반사' });
      this.deck.push({ type: 'item', shape: 'item', number: 102, itemType: 'emergency_escape', name: '긴급탈출' });
      this.deck.push({ type: 'item', shape: 'item', number: 103, itemType: 'swap', name: '스왑' });
      this.deck.push({ type: 'item', shape: 'item', number: 104, itemType: 'shuffle_seats', name: '자리바꾸기' });
    }
  }

  shuffle() {
    if (this.deck.length === 0 && this.submitzoneCards.length > 1) {
      const topCard = this.submitzoneCards.pop();
      this.deck = [...this.submitzoneCards];
      this.submitzoneCards = [topCard];
    }
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  init() {
    // 재시작 시 기존 카드 및 상태 초기화
    this.deck = [];
    this.submitzoneCards = [];
    this.currentturn = 0;
    this.attackstack = 0;
    this.lastAttackerId = null;
    this.firstOneCardCallerId = null;
    this.undirection = false;
    this.currentshape = null;
    this.turnTimeLimit = this.customRules.turnTimeLimit;

    for (const p of this.playerzone) {
      p.hand = [];
      p.onecard = false;
      p.onecardCalled = false;
      p.isEliminated = false;
      p.hiddenRule = null;
      p.ruleTargetId = null;
      p.everReachedTen = false;
      p.highRiskFailed = false;
      p.zeroPlayStreak = 0;
      p.pacifistStreak = 0;
    }

    if (this.customRules.enableHiddenRules) {
      this.assignHiddenRules();
    }
    this.createCard();
    this.shuffle();

    // 시작 바닥 카드 세팅 (첫 카드는 공격/특수 효과 미적용)
    const initialCard = this.deck.pop();
    this.submitzoneCards.push(initialCard);
    this.currentshape = initialCard.shape;

    // 참가자들에게 7장씩 지급
    const startCount = this.customRules.startingHandCount || 7;
    for (let i = 0; i < startCount; i++) {
      for (const p of this.playerzone) {
        if (this.deck.length > 0) p.hand.push(this.deck.pop());
      }
    }

    this.updateHiddenRuleStates();
  }

  // 게임 시작 직전 플레이어별로 중복 없이 히든 룰 1개씩 랜덤 부여
  assignHiddenRules() {
    const pool = [...HIDDEN_RULES_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.playerzone.forEach((p, idx) => {
      p.hiddenRule = pool[idx] || null;
    });
  }

  // 히든 룰 상태 추적 (예: 10장 이상 도달 여부 및 감소 여부)
  updateHiddenRuleStates() {
    for (const p of this.playerzone) {
      if (p.isEliminated) continue;
      if (p.everReachedTen && p.hand.length < 10) {
        p.highRiskFailed = true;
        p.everReachedTen = false;
      } else if (!p.highRiskFailed && p.hand.length >= 10) {
        p.everReachedTen = true;
      }
    }
  }

  // 예언가 등 대상을 지목하는 히든 룰의 타겟 설정
  setHiddenRuleTarget(socketId, targetId) {
    const player = this.playerzone.find(p => p.socketId === socketId);
    if (!player || player.isEliminated) {
      return { success: false, msg: '유효하지 않은 플레이어입니다.' };
    }
    const target = this.playerzone.find(
      p => (p.socketId === targetId || p.id === targetId) && p.socketId !== socketId && !p.isEliminated
    );
    if (!target) {
      return { success: false, msg: '유효한 지목 대상 플레이어를 선택해주세요.' };
    }
    player.ruleTargetId = target.id;
    return { success: true, targetId: target.id };
  }

  // 트리거형 히든 룰 달성 여부 확인
  checkTriggerRules(eventType, eventData = {}) {
    for (const p of this.playerzone) {
      if (p.isEliminated || !p.hiddenRule) continue;
      const rule = p.hiddenRule;
      if (rule.timing === 'trigger' && (!rule.event || rule.event === eventType)) {
        if (typeof rule.check === 'function' && rule.check(p, eventData, this)) {
          return {
            isOver: true,
            winner: p.id,
            reason: 'hidden_rule',
            ruleId: rule.id,
            ruleName: rule.name,
            ruleDesc: rule.desc
          };
        }
      }
    }
    return { isOver: false };
  }

  // 시간 초과 시 강제 드로우 및 턴 넘김 처리 함수 추가
  handleTimeOut() {
    const currentPlayer = this.playerzone[this.currentturn];
    if (!currentPlayer || currentPlayer.isEliminated) return { isOver: false };

    // 강제 1장 드로우 (공격 스택이 있다면 공격 스택만큼, 혹은 기본 1장)
    const wasAttacked = this.attackstack > 0;
    const attackerId = this.lastAttackerId;
    const drawCount = wasAttacked ? this.attackstack : 1;
    for (let i = 0; i < drawCount; i++) {
      if (this.deck.length === 0) this.shuffle();
      if (this.deck.length === 0) break;
      currentPlayer.hand.push(this.deck.pop());
    }
    currentPlayer.zeroPlayStreak = 0;
    currentPlayer.pacifistStreak += 1;
    this.attackstack = 0;
    this.lastAttackerId = null;
    this.checkOneCard(this.currentturn);

    if (wasAttacked && currentPlayer.hand.length === 13) {
      const sniperResult = this.checkTriggerRules('sniper_finish', {
        attackerId,
        victimId: currentPlayer.id,
        victimHandLength: currentPlayer.hand.length
      });
      if (sniperResult.isOver) return { success: true, overResult: sniperResult };
    }

    const overResult = this.gameOver();
    if (overResult.isOver) return { success: true, overResult };

    this.turnTimeLimit = 15;
    this.nextTurn(1);
    return { success: true, timeout: true, targetId: currentPlayer.id };
  }

  // 덱 드로우
  drawCard(socketId) {
    const playerIndex = this.playerzone.findIndex(p => p.socketId === socketId);
    if (playerIndex !== this.currentturn) return { success: false, msg: '차례가 아닙니다.' };
    if (this.playerzone[playerIndex].isEliminated) return { success: false, msg: '이미 탈락한 플레이어입니다.' };

    const player = this.playerzone[this.currentturn];
    const wasAttacked = this.attackstack > 0;
    const attackerId = this.lastAttackerId;
    const drawCount = wasAttacked ? this.attackstack : 1;
    for (let i = 0; i < drawCount; i++) {
      if (this.deck.length === 0) this.shuffle();
      if (this.deck.length === 0) break;
      player.hand.push(this.deck.pop());
    }

    player.zeroPlayStreak = wasAttacked ? 0 : player.zeroPlayStreak + 1;
    player.pacifistStreak += 1;
    this.attackstack = 0;
    this.lastAttackerId = null;
    this.checkOneCard(playerIndex);

    if (wasAttacked && player.hand.length === 13) {
      const sniperResult = this.checkTriggerRules('sniper_finish', {
        attackerId,
        victimId: player.id,
        victimHandLength: player.hand.length
      });
      if (sniperResult.isOver) return { success: true, overResult: sniperResult };
    }

    const overResult = this.gameOver();
    if (overResult.isOver) return { success: true, overResult };

    this.turnTimeLimit = 15;
    this.nextTurn(1);
    return { success: true };
  }

  // 카드 제출
  playCard(socketId, cardIndex, newShape, targetId) {
    const playerIndex = this.playerzone.findIndex(p => p.socketId === socketId);
    if (playerIndex !== this.currentturn) return { success: false, msg: '차례가 아닙니다.' };
    if (this.playerzone[playerIndex].isEliminated) return { success: false, msg: '이미 탈락한 플레이어입니다.' };

    const player = this.playerzone[playerIndex];
    const card = player.hand[cardIndex];
    if (!card) return { success: false, msg: '카드가 존재하지 않습니다.' };

    if (!this.checkSubmit(card, playerIndex)) {
      return { success: false, msg: '낼 수 없는 카드입니다.' };
    }

    let targetIndex = -1;
    if (card.itemType === 'swap') {
      targetIndex = this.playerzone.findIndex(p => p.socketId === targetId || p.id === targetId);
      if (targetIndex === -1 || targetIndex === playerIndex || this.playerzone[targetIndex].isEliminated) {
        return { success: false, msg: '유효한 교환 대상 플레이어를 선택해주세요.' };
      }
    }

    const prevAttackStack = this.attackstack;
    const isAttackCard = card.type === 'joker' || card.number === 1 || card.number === 2;
    player.zeroPlayStreak = 0;
    player.pacifistStreak = isAttackCard ? 0 : player.pacifistStreak + 1;
    player.hand.splice(cardIndex, 1);
    this.submitzoneCards.push(card);

    this.turnTimeLimit = this.customRules.turnTimeLimit;
    const turnAction = this.checkSpecialCard(card, newShape, playerIndex, targetIndex);
    if (this.attackstack > 0 && (card.type === 'joker' || card.number === 1 || card.number === 2 || card.itemType === 'reflect')) {
      this.lastAttackerId = player.id;
    } else if (this.attackstack === 0) {
      this.lastAttackerId = null;
    }
    this.checkOneCard(this.currentturn); // playerIndex -> currentturn
    // 다른 곳의 playerIndex는 모두 playerzone이 섞이기 전에 사용되거나, 
    // 배열 순서를 바꾸지 않는 메서드에 있음

    if (prevAttackStack >= 8) {
      const counterResult = this.checkTriggerRules('mega_counter', {
        playerId: player.id,
        prevAttackStack
      });
      if (counterResult.isOver) return { success: true, overResult: counterResult };
    }

    const overResult = this.gameOver();
    if (overResult.isOver) return { success: true, overResult };

    if (turnAction === 'skip') {
      this.nextTurn(2);
    } else if (turnAction === 'reflect') {
      this.nextTurn(1, -1);
    } else if (turnAction !== 'keep_turn') {
      this.nextTurn(1);
    }
    return { success: true };
  }

  checkSubmit(card, playerIndex) {
    const topCard = this.submitzoneCards[this.submitzoneCards.length - 1];
    if (this.attackstack > 0) return this.canDefend(card, topCard);
    if (card.itemType === 'reflect') return false;
    if (
      card.type === 'joker' ||
      topCard.type === 'joker' ||
      this.currentshape === 'joker' ||
      card.type === 'item' ||
      topCard.type === 'item' ||
      this.currentshape === 'item'
    ) {
      return true;
    }
    return card.number === topCard.number || card.shape === this.currentshape;
  }

  canDefend(card, topCard) {
    if (topCard.itemType === 'reflect') {
      return false; // 일반 방어 불가 (추후 천사카드 등으로만 방어 가능)
    }
    if (card.itemType === 'reflect') {
      return true;
    }
    if (topCard.number === 2) {
      return card.number === 3 || card.number === 2 || card.number === 1 || card.type === 'joker';
    } else if (topCard.number === 1) {
      return card.number === 1 || card.type === 'joker';
    } else if (topCard.type === 'joker') {
      return topCard.jokerType === 'black' && card.type === 'joker' && card.jokerType === 'color';
    }
    return false;
  }

  checkSpecialCard(card, newShape, playerIndex, targetIndex) {
    if (card.type === 'joker') {
      this.attackstack += (card.jokerType === 'color') ? 7 : 5;
      this.currentshape = 'joker';
      return;
    }
    if (card.type === 'item') {
      this.currentshape = 'item';
      if (card.itemType === 'fast_forward') {
        this.turnTimeLimit = 5;
        return;
      }
      if (card.itemType === 'reflect') {
        return 'reflect';
      }
      if (card.itemType === 'emergency_escape') {
        const hand = this.playerzone[playerIndex].hand;
        const discardCount = Math.floor(hand.length / 2);
        const discarded = [];
        for (let i = 0; i < discardCount; i++) {
          const randIdx = Math.floor(Math.random() * hand.length);
          discarded.push(hand.splice(randIdx, 1)[0]);
        }
        for (let i = discarded.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [discarded[i], discarded[j]] = [discarded[j], discarded[i]];
        }
        this.deck.unshift(...discarded);
        return;
      }
      // 이후 server.js에서 스왑 연동을 할 때는
      // 클라이언트가 보낸 targetId를
      // room.game.playCard(socket.id, cardIndex, newShape, targetId)로 전달하면 됩니다.
      if (card.itemType === 'swap') {
        const player = this.playerzone[playerIndex];
        const target = this.playerzone[targetIndex];
        [player.hand, target.hand] = [target.hand, player.hand];
        this.checkOneCard(targetIndex);
        return;
      }
      // p.id는 그대로 두고 this.playerzone 배열의 순서만 셔플
      if (card.itemType === 'shuffle_seats') {
        const currentSocketId = this.playerzone[playerIndex].socketId;
        for (let i = this.playerzone.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [this.playerzone[i], this.playerzone[j]] = [this.playerzone[j], this.playerzone[i]];
        }
        this.currentturn = this.playerzone.findIndex(p => p.socketId === currentSocketId);
        return;
      }
      return;
    }
    this.currentshape = card.shape;
    switch (card.number) {
      case 1: this.attackstack += 3; break;
      case 2: this.attackstack += 2; break;
      case 3: if (this.attackstack > 0) this.attackstack = 0; break;
      case 7:
        if (['spade', 'heart', 'diamond', 'clover'].includes(newShape)) this.currentshape = newShape;
        break;
      case 11: return 'skip';
      case 12: this.undirection = !this.undirection; break;
      case 13: return 'keep_turn';
    }
  }

  checkOneCard(idx) {
    const player = this.playerzone[idx];
    if (player.hand.length === 1) {
      if (!player.onecard) {
        player.onecard = true;
        player.onecardCalled = false;
      }
    } else {
      player.onecard = false;
      player.onecardCalled = false;
    }
  }

  // 원카드 외치기 / 저지 처리
  callOneCard(socketId) {
    const callerIdx = this.playerzone.findIndex(p => p.socketId === socketId);
    if (callerIdx === -1 || this.playerzone[callerIdx].isEliminated) {
      return { success: false, msg: '유효하지 않은 플레이어입니다.' };
    }

    const caller = this.playerzone[callerIdx];

    // 1) 본인 패가 1장일 때 먼저 외친 경우 -> 방어 성공
    if (caller.onecard && !caller.onecardCalled) {
      caller.onecardCalled = true;
      const isFirstDefend = !this.firstOneCardCallerId;
      if (isFirstDefend) {
        this.firstOneCardCallerId = caller.id;
      }
      const overResult = this.checkTriggerRules('onecard_defend', {
        callerId: caller.id,
        callerSocketId: caller.socketId,
        isFirstDefend
      });
      return { success: true, type: 'defend', callerId: caller.id, overResult };
    }

    // 2) 다른 사람이 먼저 외쳐서 미선언 원카드 보유자를 저지하는 경우 -> 1장 벌칙 드로우
    const penalized = [];
    for (let i = 0; i < this.playerzone.length; i++) {
      const p = this.playerzone[i];
      if (i !== callerIdx && !p.isEliminated && p.onecard && !p.onecardCalled) {
        if (this.deck.length === 0) this.shuffle();
        if (this.deck.length > 0) p.hand.push(this.deck.pop());
        this.checkOneCard(i);
        penalized.push(p.id);
      }
    }

    if (penalized.length > 0) {
      const overResult = this.gameOver();
      return { success: true, type: 'penalty', callerId: caller.id, penalized, overResult };
    }

    return { success: false, msg: '원카드 선언 대상이 없습니다.' };
  }

  // 게임 도중 플레이어 퇴장 처리
  handlePlayerLeave(socketId) {
    const playerIndex = this.playerzone.findIndex(p => p.socketId === socketId);
    if (playerIndex === -1) return { success: false, msg: '플레이어를 찾을 수 없습니다.' };

    const player = this.playerzone[playerIndex];
    if (player.isEliminated) return { success: false, msg: '이미 탈락한 플레이어입니다.' };

    player.isEliminated = true;
    player.onecard = false;
    player.onecardCalled = false;
    if (player.hand.length > 0) {
      this.submitzoneCards.unshift(...player.hand);
      player.hand = [];
    }

    const overResult = this.gameOver();
    if (overResult.isOver) return { success: true, overResult };

    // 퇴장한 플레이어의 턴이었다면 다음 생존 플레이어로 턴 전환
    if (this.currentturn === playerIndex) {
      this.turnTimeLimit = 15;
      this.nextTurn(1);
    }
    return { success: true, overResult: { isOver: false } };
  }

  gameOver() {
    this.updateHiddenRuleStates();

    // 15장 이상 파산 처리
    const bankruptLimit = this.customRules.bankruptcyLimit || 15;
    for (const p of this.playerzone) {
      if (!p.isEliminated && p.hand.length >= bankruptLimit) {
        p.isEliminated = true;
        p.onecard = false;
        p.onecardCalled = false;
        this.submitzoneCards.unshift(...p.hand);
        p.hand = [];
      }
    }

    // 1) instant 히든 룰 달성 즉시 승리 확인
    if (this.customRules.enableHiddenRules) {
      for (const p of this.playerzone) {
        if (!p.isEliminated && p.hiddenRule && p.hiddenRule.timing === 'instant') {
          if (typeof p.hiddenRule.check === 'function' && p.hiddenRule.check(p, this)) {
            return {
              isOver: true,
              winner: p.id,
              reason: 'hidden_rule',
              ruleId: p.hiddenRule.id,
              ruleName: p.hiddenRule.name,
              ruleDesc: p.hiddenRule.desc
            };
          }
        }
      }
    }

    // 2) 일반 게임 종료 조건 확인 (손패 0장 클리어 / 최후의 1인 / 무승부)
    let normalOverResult = null;
    for (const p of this.playerzone) {
      if (!p.isEliminated && p.hand.length === 0) {
        normalOverResult = { isOver: true, winner: p.id, reason: 'clear' };
        break;
      }
    }

    if (!normalOverResult) {
      const survivors = this.playerzone.filter(p => !p.isEliminated);
      if (survivors.length === 1) {
        normalOverResult = { isOver: true, winner: survivors[0].id, reason: 'last' };
      } else if (survivors.length === 0) {
        normalOverResult = { isOver: true, winner: null, reason: 'draw' };
      }
    }

    // 3) 게임 종료 시점(endgame) 히든 룰 달성 플레이어가 있다면 히든 룰 승리 우선 적용
    if (normalOverResult) {
      for (const p of this.playerzone) {
        if (!p.isEliminated && p.hiddenRule && p.hiddenRule.timing === 'endgame') {
          if (typeof p.hiddenRule.check === 'function' && p.hiddenRule.check(p, this)) {
            return {
              isOver: true,
              winner: p.id,
              reason: 'hidden_rule',
              ruleId: p.hiddenRule.id,
              ruleName: p.hiddenRule.name,
              ruleDesc: p.hiddenRule.desc
            };
          }
        }
      }
      return normalOverResult;
    }

    return { isOver: false };
  }

  nextTurn(stepCount = 1, direction = 1) {
    if (!this.playerzone.some(p => !p.isEliminated)) return;
    const total = this.playerzone.length;
    const step = (this.undirection ? -1 : 1) * direction;
    let remain = stepCount;
    let nextIdx = this.currentturn;
    while (remain > 0) {
      nextIdx = (((nextIdx + step) % total) + total) % total;
      if (!this.playerzone[nextIdx].isEliminated) remain--;
    }
    this.currentturn = nextIdx;
  }

  // 개별 플레이어 본인 손패 조회 (개인 소켓 전송용)
  getPlayerHand(socketId) {
    const player = this.playerzone.find(p => p.socketId === socketId);
    return player ? [...player.hand] : [];
  }

  // 개별 플레이어 본인 히든 룰 조회 (개인 소켓 전송용)
  getPlayerHiddenRule(socketId) {
    const player = this.playerzone.find(p => p.socketId === socketId);
    if (!player || !player.hiddenRule) return null;
    return {
      id: player.hiddenRule.id,
      name: player.hiddenRule.name,
      desc: player.hiddenRule.desc,
      timing: player.hiddenRule.timing,
      targetId: player.ruleTargetId
    };
  }

  // 화면에 브로드캐스트할 데이터 추출
  getPublicState() {
    return {
      topCard: this.submitzoneCards[this.submitzoneCards.length - 1],
      currentShape: this.currentshape,
      currentTurnSocketId: this.playerzone[this.currentturn]?.socketId,
      currentTurnId: this.playerzone[this.currentturn]?.id,
      attackStack: this.attackstack,
      undirection: this.undirection,
      deckCount: this.deck.length,
      turnTimeLimit: this.turnTimeLimit,
      // 상대 플레이어 손패는 장수만 전달 (보안)
      players: this.playerzone.map(p => ({
        id: p.id,
        name: p.name,
        socketId: p.socketId,
        cardCount: p.hand.length,
        onecard: p.onecard,
        onecardCalled: p.onecardCalled,
        isEliminated: p.isEliminated
      }))
    };
  }
}

OneCardGame.HIDDEN_RULES_POOL = HIDDEN_RULES_POOL;
module.exports = OneCardGame;