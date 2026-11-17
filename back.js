// back.js (Node.js CommonJS 기준)

//커스텀 히든 룰
const HIDDEN_RULES_POOL = [
  {
    id: 'FOUR_SEVENS',
    name: '럭키 세븐',
    desc: '숫자 7 카드 4장 모으기 (달성 즉시 승리)',
    timing: 'instant',
    check: p => p.hand.filter(c => c.number === 7).length >= 4
  },
  {
    id: 'ROYAL_FAMILY',
    name: '로열 패밀리',
    desc: '종료 시 모든 패가 K, Q, J로만 구성',
    timing: 'endgame',
    check: p => p.hand.length > 0 && p.hand.every(c => [11, 12, 13].includes(c.number))
  },
  {
    id: 'STRAIGHT',
    name: '스트레이트',
    desc: '종료 시 모든 패가 연속된 숫자로 구성 (패 5장 이상)',
    timing: 'endgame',
    check: p => {
      if (p.hand.length < 5 || p.hand.some(c => c.number === 99)) return false;
      const nums = p.hand.map(c => c.number).sort((a, b) => a - b);
      for (let i = 0; i < nums.length - 1; i++) {
        if (nums[i + 1] !== nums[i] + 1) return false;
      }
      return true;
    }
  },
  {
    id: 'HIGH_RISK',
    name: '하이 리턴 하이 리스크',
    desc: '종료 시까지 패 10장 이상 유지 (10장 달성 후 감소 시 실패)',
    timing: 'endgame',
    check: p => Boolean(p.everReachedTen && p.hand.length >= 10)
  },
  {
    id: 'RED_BLACK',
    name: 'RED OR BLACK',
    desc: '종료 시 모든 패 색상(올 레드/올 블랙) 통일 (패 5장 이상)',
    timing: 'endgame',
    check: p => {
      if (p.hand.length < 5) return false;
      const isRed = c => ['heart', 'diamond'].includes(c.shape) || c.jokerType === 'color';
      const isBlack = c => ['spade', 'clover'].includes(c.shape) || c.jokerType === 'black';
      return p.hand.every(isRed) || p.hand.every(isBlack);
    }
  },
  {
    id: 'PACIFIST',
    name: '평화주의자',
    desc: '종료 시 조커, 1, 2, 7, J, Q, K를 제외한 카드만 보유',
    timing: 'endgame',
    check: p => {
      if (p.hand.length === 0) return false;
      const excluded = [1, 2, 7, 11, 12, 13, 99];
      return p.hand.every(c => !excluded.includes(c.number));
    }
  },
  {
    id: 'SPECIALIST',
    name: '스페셜리스트',
    desc: '조커, 1, 2, 7, J, Q, K를 모두 1장씩 보유 (달성 즉시 승리)',
    timing: 'instant',
    check: p => {
      const reqs = [1, 2, 7, 11, 12, 13, 99];
      return reqs.every(r => p.hand.some(c => c.number === r));
    }
  },
  {
    id: 'PROPHET',
    name: '예언가',
    desc: '지목한 플레이어가 원카드 선언에 성공하면 즉시 승리',
    timing: 'trigger'
  }
];


class OneCardGame {
  constructor(playerList,customRules={}) {
    
    this.customRules = {
      turnTimeLimit: customRules.turnTimeLimit || 15,
      startingHandCount: customRules.startingHandCount || 7,
      bankruptcyLimit: customRules.bankruptcyLimit || 15,
      enableHiddenRules: Boolean(customRules.enableHiddenRules)
    };

    this.turnTimeLimit = this.customRules.turnTimeLimit;


    this.playerzone = playerList.map((p, idx) => ({
      socketId: p.socketId,
      id: `P${idx + 1}`,
      name: p.name,
      hand: [],
      onecard: false,
      onecardCalled: false,
      isEliminated: false
    }));

    this.deck = [];
    this.submitzoneCards = [];
    this.currentturn = 0;
    this.attackstack = 0;
    this.undirection = false; // false: 시계, true: 반시계
    this.currentshape = null;

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
    this.undirection = false;
    this.currentshape = null;

    for (const p of this.playerzone) {
      p.hand = [];
      p.onecard = false;
      p.onecardCalled = false;
      p.isEliminated = false;
      p.hiddenRule = null;
      p.everReachedTen = false;
      p.prophetTargetSocketId = null;
      p.prophetTargetName = null;
    }

    this.createCard();
    this.shuffle();

    // 시작 바닥 카드 세팅 (첫 카드는 공격/특수 효과 미적용)
    const initialCard = this.deck.pop();
    this.submitzoneCards.push(initialCard);
    this.currentshape = initialCard.shape;

    const handCount = this.customRules.startingHandCount;
    // 참가자들에게 7장씩 지급
    for (let i = 0; i < handCount; i++) {
      for (const p of this.playerzone) {
        if (this.deck.length > 0) p.hand.push(this.deck.pop());
      }
    }

    // 히든 룰 배정 (체크박스 활성화 시)
    if (this.customRules.enableHiddenRules) {
      const shuffled = [...HIDDEN_RULES_POOL].sort(() => Math.random() - 0.5);
      this.playerzone.forEach((p, idx) => {
        const rule = shuffled[idx % shuffled.length];
        p.hiddenRule = { ...rule };

        // 하이 리턴 하이 리스크 초기 상태 체크
        if (p.hand.length >= 10) p.everReachedTen = true;

        // 예언가인 경우 본인 제외 랜덤 타겟 지정
        if (rule.id === 'PROPHET') {
          const others = this.playerzone.filter(other => other.socketId !== p.socketId);
          if (others.length > 0) {
            const target = others[Math.floor(Math.random() * others.length)];
            p.prophetTargetSocketId = target.socketId;
            p.prophetTargetName = target.name;
            p.hiddenRule.desc = `[${target.name}]님이 원카드 선언에 성공하면 즉시 승리`;
          }
        }
      });
    }
  }

  // 패 변동 시 상태 추적 및 1, 7번 즉시 승리 판별
  onHandChanged(player) {
    if (!this.customRules.enableHiddenRules || !player || player.isEliminated) return null;

    if (player.hand.length >= 10) {
      player.everReachedTen = true;
    }

    if (player.hiddenRule && player.hiddenRule.timing === 'instant') {
      if (player.hiddenRule.check(player)) {
        return {
          isOver: true,
          winner: player.id,
          winnerName: player.name,
          reason: 'hidden',
          hiddenRuleName: player.hiddenRule.name,
          hiddenRuleDesc: player.hiddenRule.desc
        };
      }
    }
    return null;
  }

  // 시간 초과 시 강제 드로우 및 턴 넘김 처리 함수 추가
  handleTimeOut() {
    const currentPlayer = this.playerzone[this.currentturn];
    if (!currentPlayer || currentPlayer.isEliminated) return { isOver: false };

    // 강제 1장 드로우 (공격 스택이 있다면 공격 스택만큼, 혹은 기본 1장)
    const drawCount = this.attackstack > 0 ? this.attackstack : 1;
    for (let i = 0; i < drawCount; i++) {
      if (this.deck.length === 0) this.shuffle();
      if (this.deck.length === 0) break;
      currentPlayer.hand.push(this.deck.pop());
    }
    this.attackstack = 0;
    this.checkOneCard(this.currentturn);

    const overResult = this.gameOver();
    if (overResult.isOver) return { success: true, overResult };

    this.nextTurn(1);
    return { success: true, timeout: true, targetId: currentPlayer.id };
  }

  // 덱 드로우
  drawCard(socketId) {
    const playerIndex = this.playerzone.findIndex(p => p.socketId === socketId);
    if (playerIndex !== this.currentturn) return { success: false, msg: '차례가 아닙니다.' };
    if (this.playerzone[playerIndex].isEliminated) return { success: false, msg: '이미 탈락한 플레이어입니다.' };

    const drawCount = this.attackstack > 0 ? this.attackstack : 1;
    for (let i = 0; i < drawCount; i++) {
      if (this.deck.length === 0) this.shuffle();
      if (this.deck.length === 0) break;
      this.playerzone[this.currentturn].hand.push(this.deck.pop());
    }

    this.attackstack = 0;
    this.checkOneCard(playerIndex);
    const overResult = this.gameOver();
    if (overResult.isOver) return { success: true, overResult };

    this.nextTurn(1);
    return { success: true };
  }

  // 카드 제출
  playCard(socketId, cardIndex, newShape) {
    const playerIndex = this.playerzone.findIndex(p => p.socketId === socketId);
    if (playerIndex !== this.currentturn) return { success: false, msg: '차례가 아닙니다.' };
    if (this.playerzone[playerIndex].isEliminated) return { success: false, msg: '이미 탈락한 플레이어입니다.' };

    const player = this.playerzone[playerIndex];
    const card = player.hand[cardIndex];
    if (!card) return { success: false, msg: '카드가 존재하지 않습니다.' };

    if (!this.checkSubmit(card, playerIndex)) {
      return { success: false, msg: '낼 수 없는 카드입니다.' };
    }

    player.hand.splice(cardIndex, 1);
    this.submitzoneCards.push(card);

    const turnAction = this.checkSpecialCard(card, newShape);
    this.checkOneCard(playerIndex);

    const overResult = this.gameOver();
    if (overResult.isOver) return { success: true, overResult };

    if (turnAction === 'skip') {
      this.nextTurn(2);
    } else if (turnAction !== 'keep_turn') {
      this.nextTurn(1);
    }
    return { success: true };
  }

  checkSubmit(card, playerIndex) {
    const topCard = this.submitzoneCards[this.submitzoneCards.length - 1];
    if (this.attackstack > 0) return this.canDefend(card, topCard);
    if (card.type === 'joker' || topCard.type === 'joker' || this.currentshape === 'joker') return true;
    return card.number === topCard.number || card.shape === this.currentshape;
  }

  canDefend(card, topCard) {
    if (topCard.number === 2) {
      return card.number === 3 || card.number === 2 || card.number === 1 || card.type === 'joker';
    } else if (topCard.number === 1) {
      return card.number === 1 || card.type === 'joker';
    } else if (topCard.type === 'joker') {
      return topCard.jokerType === 'black' && card.type === 'joker' && card.jokerType === 'color';
    }
    return false;
  }

  checkSpecialCard(card, newShape) {
    if (card.type === 'joker') {
      this.attackstack += (card.jokerType === 'color') ? 7 : 5;
      this.currentshape = 'joker';
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
      if (this.customRules.enableHiddenRules) {
        const prophet = this.playerzone.find(
          p => !p.isEliminated && p.hiddenRule?.id === 'PROPHET' && p.prophetTargetSocketId === caller.socketId
        );
        if (prophet) {
          return {
            success: true,
            type: 'defend',
            callerId: caller.id,
            overResult: {
              isOver: true,
              winner: prophet.id,
              winnerName: prophet.name,
              reason: 'hidden',
              hiddenRuleName: prophet.hiddenRule.name,
              hiddenRuleDesc: `${caller.name}님의 원카드 선언 적중!`
            }
          };
        }
      }
      return { success: true, type: 'defend', callerId: caller.id };
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
      this.nextTurn(1);
    }
    return { success: true, overResult: { isOver: false } };
  }

  // 종료 시점 히든 룰(2~6번) 우선 판별 헬퍼
  resolveEndGameResult(defaultResult) {
    if (this.customRules.enableHiddenRules) {
      for (const p of this.playerzone) {
        if (!p.isEliminated && p.hiddenRule && p.hiddenRule.timing === 'endgame') {
          if (p.hiddenRule.check(p)) {
            return {
              isOver: true,
              winner: p.id,
              winnerName: p.name,
              reason: 'hidden',
              hiddenRuleName: p.hiddenRule.name,
              hiddenRuleDesc: p.hiddenRule.desc
            };
          }
        }
      }
    }
    return defaultResult;
  }

  gameOver() {
    
    for (const p of this.playerzone) {
      if (!p.isEliminated && p.hand.length === 0) {
        return { isOver: true, winner: p.id, reason: 'clear' };
      }
    }
    // 15장 이상 파산 처리
    const bankruptcyLimit = this.customRules.bankruptcyLimit;
    for (const p of this.playerzone) {
      if (!p.isEliminated && p.hand.length >= bankruptcyLimit) {
        p.isEliminated = true;
        p.onecard = false;
        p.onecardCalled = false;
        this.submitzoneCards.unshift(...p.hand);
        p.hand = [];
      }
    }
    const survivors = this.playerzone.filter(p => !p.isEliminated);
    if (survivors.length === 1) {
      return this.resolveEndGameResult({ isOver: true, winner: survivors[0].id, reason: 'last' });
    }
    if (survivors.length === 0) {
      return this.resolveEndGameResult({ isOver: true, winner: null, reason: 'draw' });
    }
    return { isOver: false };
  }

  nextTurn(stepCount = 1) {
    if (!this.playerzone.some(p => !p.isEliminated)) return;
    const total = this.playerzone.length;
    const step = this.undirection ? -1 : 1;
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

module.exports = OneCardGame;
