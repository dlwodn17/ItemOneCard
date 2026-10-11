const targetX=400;// 중앙
const targetY=400; // 중앙



let deck = []; 
// 54장 트럼프 카드(하트, 스페이드, 클로버, 다이아 각각 13장, 조커 2장)
let suffle = false; // 덱이 섞였는지 여부
let draw = false; // 드로우 했는지 여부
let endturn = false; // 차례가 끝났는지 여부 
// 원카드 여부는 플레이어별로 관리 → playerzone[i].onecard 참고
let undirection = false; // 플레이 방향 (false: 시계방향, true:반시계방향)
let currentshape = null; // 현재 카드 문양
let currentturn = 0; // 현재 누구 턴인지 
let attackstack = 0; // 공격 누적


const submitzone = new PIXI.Graphics();
let submitzoneCards = [];
// 내려고하는 카드 제출되는 곳
const deckzone = new PIXI.Graphics();
// 덱 더미 위치
const MIN_PLAYERS = 2; // 최소 플레이어 수
const MAX_PLAYERS = 4; // 최대 플레이어 수
const playerzone = []; // 플레이어들 위치, 패, 원카드 여부, 탈락 여부
// init(playerCount) 호출 시 실제 참가 인원(2~4명)만큼만 생성됨 → 빈자리는 존재하지 않음
// 형태: {id: 'P1', hand: [], onecard: false, isEliminated: false}

//========================================
//  기본 세팅 파트 - 카드 생성, 셔플, 초기 세팅
//========================================
function createcard(){
// 카드 앞면 트럼프카드 54가지 종류 생성, 뒷면 1가지 생성
//1. 모양 그리기 함수 (하트, 다이아, 클로버, 스페이드)
//2. 숫자 그리기 함수
//3. 조커 2장
//4. 뒷면 그리기 함수

    const shapes = ['spade','heart','diamond','clover'];
    const shapeSymbols = { spade: '♠', heart: '♥', diamond: '◆', clover: '♣' };
    const shapeColors = { spade: 0x000000, heart: 0xff0000, diamond: 0xff0000, clover: 0x000000 };

    const cardWidth = 80;
    const cardHeight = 120;
    
    shapes.forEach(shape=>{
        for(let num=1; num<=13;num++){
            const card = new PIXI.Container();

            const frontGraphics = new PIXI.Graphics();
            frontGraphics.beginFill(0xffffff);
            frontGraphics.lineStyle(2, 0x000000);
            frontGraphics.drawRoundedRect(0, 0, cardWidth, cardHeight, 8);
            frontGraphics.endFill();
            card.addChild(frontGraphics);

            let numText = num.toString();
            if(num == 1) {numText = 'A';}
            else if(num == 11){numText = 'J';}
            else if(num == 12){numText = 'Q';}
            else if(num == 13){numText = 'K'}

            const style = new PIXI.TextStyle({
                fontSize: 16,
                fill: shapeColors[shape],
                fontWeight: 'bold'
            });

            const text = new PIXI.Text(`${numText}\n${shapeSymbols[shape]}`,style);
            text.x = 8;
            text.y = 8;
            card.addChild(text);

            const backGraphics = new PIXI.Graphics();
            backGraphics.beginFill(0x3366cc);
            backGraphics.lineStyle(2, 0xffffff);
            backGraphics.drawRoundedRect(0, 0, cardWidth, cardHeight, 8);
            backGraphics.endFill();
            backGraphics.visible = false;
            card.addChild(backGraphics);

            deck.push({
                type: 'normal',
                shape: shape,
                number: num,
                view: card,
                isFront: true
            });
        }
    });

    const jokers = [{ colorType: 'black', name: '흑조커', color: 0x555555 },
        { colorType: 'color', name: '컬조커', color: 0xff0055 }
    ];

    jokers.forEach(joker=>{
        const card = new PIXI.Container();

        const frontGraphics = new PIXI.Graphics();
        frontGraphics.beginFill(0xf0f0f0);
        frontGraphics.lineStyle(2, joker.color);
        frontGraphics.drawRoundedRect(0, 0, cardWidth, cardHeight, 8);
        frontGraphics.endFill();
        card.addChild(frontGraphics);

        const style = new PIXI.TextStyle({
            fontSize: 14,
            fill: joker.color,
            fontWeight: 'bold'
        });

        const text = new PIXI.Text(`JOKER\n(${joker.name})`, style);
        text.x = 8;
        text.y = 8;
        card.addChild(text);

        const backGraphics = new PIXI.Graphics();
        backGraphics.beginFill(0x3366cc);
        backGraphics.lineStyle(2, 0xffffff);
        backGraphics.drawRoundedRect(0, 0, cardWidth, cardHeight, 8);
        backGraphics.endFill();
        backGraphics.visible = false;
        card.addChild(backGraphics);

        deck.push({
            type: 'joker',
            shape: 'joker',
            number: 99,
            jokerType: joker.colorType,
            view: card,
            isFront: true
        });
    });
}

function sufflecard(){
// 덱을 섞는 함수
// 1. 덱을 섞음
// 2. deck 배열 길이가 0 되면 submitzone 맨위 한장 남기고 deckzone으로 옮기고 섞음 
    if(deck.length == 0 && submitzoneCards.length > 1){
        const topCard = submitzoneCards.pop();
        deck = [...submitzoneCards];
        submitzoneCards = [topCard];
    }

    for(let i = deck.length - 1; i>0; i--){
        const j = Math.floor(Math.random()* (i+1));
        [deck[i],deck[j]] = [deck[j],deck[i]]  
    }
    suffle = true;
}


function init(playerCount = MAX_PLAYERS){
// 카드 초기화 및 초기 세팅 
// 1. 처음에 카드 값들 덱에 임의 순서로 생성
// 2. 처음에 submitzone에 임의카드 1장 세팅
// 3. 게임 시작하고 플레이어들에게 패로 7장 카드 뿌려줌 
// playerCount: 실제 참가 인원 (2~4명). 참가자에게만 패를 나눠주고 턴을 줌
// 나중에 server.js와 연결할 때 init(room.players.length)처럼 실제 인원수를 넘기면 됩니다.
   
    if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
        console.log(`플레이어 수는 ${MIN_PLAYERS}~${MAX_PLAYERS}명이어야 합니다. (입력: ${playerCount})`);
        return false;
    }

    currentturn = 0;
    attackstack = 0;
    undirection = false;
    currentshape = null;
    deck = []; // 재시작 시 이전 덱 잔여 카드 제거 (카드 중복 방지)
    submitzoneCards = [];

    // 참가 인원만큼만 플레이어 생성 (빈자리 없음)
    playerzone.length = 0;
    for (let i = 0; i < playerCount; i++) {
        playerzone.push({ id: `P${i + 1}`, hand: [], onecard: false, isEliminated: false });
    }

    createcard();
    sufflecard();


    if(deck.length > 0){
        const initialCard = deck.pop();
        submitzoneCards.push(initialCard);
        currentshape = initialCard.shape;
        // ※ 규칙: 첫 시작 바닥 카드는 공격/특수 효과가 적용되지 않고 일반 카드로 취급 (attackstack = 0 유지)
    }

    for(let i = 0; i < 7; i++){
        for(let j = 0; j < playerzone.length; j++){
            if(deck.length >0){
                playerzone[j].hand.push(deck.pop());
            }
        }
    }
    return true;
}


//=====================================================
//  게임 플레이 파트 - 드로우, 제출, 턴, 특수 카드, 카드 누적
//=====================================================
function drawcard(playerIndex = currentturn){
// 덱에서 드로우하는 함수
// 1. 자신의 차례에 낼 수 있는 카드 없을 때 드로우
// 덱을 클릭하면 제일 위에 한장 패로 추가
// 2. 상대방의 공격으로 인한 드로우
// A 3장 , 2 2장, 컬러조커 7장, 흑백조커 5장
    if (playerIndex !== currentturn) {
        console.log(`지금은 플레이어 P${playerIndex + 1}의 차례가 아닙니다.`);
        return false;
    }
    if (playerzone[playerIndex].isEliminated) {
        console.log(`플레이어 P${playerIndex + 1}는 이미 탈락했습니다.`);
        return false;
    }

    const drawcount = attackstack > 0 ? attackstack : 1;
    for(let i = 0; i < drawcount; i++ ){
        if(deck.length == 0){
            sufflecard();
        }

        if(deck.length == 0){
            break;
        }   

        const card = deck.pop();
        playerzone[currentturn].hand.push(card);
    }

    attackstack = 0;
    draw = true;

    // 카드를 뽑았으므로 원카드 상태 갱신
    checkonecard(playerIndex);

    // 파산 및 게임 종료 여부 확인
    const overResult = gameover();
    if (overResult.isOver) {
        return { success: true, gameOver: true, result: overResult };
    }

    // 드로우 후 턴 전환
    nextturn(1);
    return { success: true, gameOver: false };
}

function playCard(playerIndex, cardOrIndex) {
    // 1. 차례 검증
    if (playerIndex !== currentturn) {
        console.log(`지금은 플레이어 P${playerIndex + 1}의 차례가 아닙니다.`);
        return false;
    }
    if (playerzone[playerIndex].isEliminated) {
        console.log(`플레이어 P${playerIndex + 1}는 이미 탈락했습니다.`);
        return false;
    }

    const player = playerzone[playerIndex];
    let card = null;
    let cardIndex = -1;

    if (typeof cardOrIndex === 'number') {
        cardIndex = cardOrIndex;
        card = player.hand[cardIndex];
    } else {
        card = cardOrIndex;
        cardIndex = player.hand.indexOf(card);
    }

    if (!card || cardIndex === -1) {
        console.log("패에 존재하지 않는 카드입니다.");
        return false;
    }

    // 2. 제출 가능 여부 검증 (checksubmit)
    if (!checksubmit(card, playerIndex)) {
        console.log("현재 바닥 카드에 낼 수 없는 카드입니다.");
        return false;
    }

    // 3. 카드 제출 (손패 -> 제출 더미)
    player.hand.splice(cardIndex, 1);
    submitzoneCards.push(card);
    console.log(`P${playerIndex + 1} 카드 제출:`, card.type === 'joker' ? (card.name || card.jokerType) : `${card.shape} ${card.number}`);

    // 4. 특수 효과 및 공격/방어 발동 (checkspecialcard)
    const turnAction = checkspecialcard(card);

    // 5. 원카드 및 승리/파산 검사
    checkonecard(playerIndex);
    const overResult = gameover();
    if (overResult.isOver) {
        return { success: true, gameOver: true, result: overResult };
    }

    // 6. 턴 넘기기 파이프라인
    if (turnAction === 'keep_turn') {
        // K 카드: 현재 플레이어가 한 번 더 플레이
        console.log(`K 발동: P${playerIndex + 1}의 차례가 한 번 더 유지됩니다.`);
    } else if (turnAction === 'skip') {
        // J 카드: 다음 사람 건너뛰고 다다음 플레이어로 전환
        nextturn(2);
    } else {
        // 일반 카드 및 기타: 다음 플레이어로 전환
        nextturn(1);
    }

    return { success: true, gameOver: false };
}

//=====================================================
//  게임 플레이 파트 - 검증, 특수능력, 누적 규칙 구현
//=====================================================

function checksubmit(card, playerIndex) {
    // 1. 현재 턴인 플레이어가 맞는지 확인
    if (playerIndex !== currentturn) {
        console.log("지금은 해당 플레이어의 차례가 아닙니다.");
        return false;
    }
    if (playerzone[playerIndex].isEliminated) {
        return false;
    }

    if (submitzoneCards.length === 0) return false;
    const topCard = submitzoneCards[submitzoneCards.length - 1];

    // 1) 공격 누적 중인 경우: 방어/누적 가능 여부 판정 (조커 및 일반 카드 공통)
    if (attackstack > 0) {
        return canDefendOrStack(card, topCard);
    }

    // 2) 일반 상황 (공격 스택이 없을 때)
    // 조커는 언제든지 제출 가능
    if (card.type === 'joker') {
        return true;
    }

    // 맨 위 카드가 조커이거나 현재 지정된 문양이 'joker'인 경우: 어떤 일반 카드도 자유롭게 제출 가능
    if (topCard.type === 'joker' || currentshape === 'joker') {
        return true;
    }

    // 맨 위 카드와 숫자가 같거나, 문양이 같거나, 현재 지정된 문양(currentshape)과 같은 경우
    const matchesNumber = (card.number === topCard.number);
    const matchesShape = (card.shape === topCard.shape || card.shape === currentshape);

    return matchesNumber || matchesShape;
}

function canDefendOrStack(card, topCard) {
    // 공격 상황에서의 규칙 처리 (※ 문양 무관: 바닥 카드와 문양이 달라도 해당 숫자/카드면 누적 및 방어 가능)
    // A: 3장 공격, 2: 2장 공격, 흑조: 5장, 컬조: 7장
    if (topCard.number === 2) {
        // 2의 공격은 2, A, 흑조, 컬조로 누적 가능, 3으로 방어 가능 (문양 무관)
        if (card.number === 3) return true; // 방어
        if (card.number === 2 || card.number === 1 || card.type === 'joker') return true;
    } else if (topCard.number === 1) { // A
        // A의 공격은 A, 흑조, 컬조로 누적 가능 (문양 무관)
        if (card.number === 1 || card.type === 'joker') return true;
    } else if (topCard.type === 'joker') {
        if (topCard.jokerType === 'color') {
            // 컬조는 위로 누적 불가, 드로우로 받아야 함
            return false;
        } else if (topCard.jokerType === 'black') {
            // 흑조는 컬조로만 누적 가능
            if (card.type === 'joker' && card.jokerType === 'color') return true;
        }
    }
    return false;
}

function checkspecialcard(card) {
    // 특수 카드 능력치 및 공격 스택 설정
    if (card.type === 'joker') {
        if (card.jokerType === 'color') {
            attackstack += 7;
        } else if (card.jokerType === 'black') {
            attackstack += 5;
        }
        currentshape = 'joker';
        return;
    }

    switch (card.number) {
        case 1: // A
            attackstack += 3;
            break;
        case 2: // 2
            attackstack += 2;
            break;
        case 3: // 3 (2 방어용, 공격 스택 초기화 또는 유지 관리)
            if (attackstack > 0) {
                attackstack = 0; // 방어 성공 시 스택 해제
            }
            break;
        case 7: // 7 (문양 변경)
            // TODO: 플레이어가 원하는 문양(spade, heart, diamond, clover)을 선택하는 UI/로직 연동 필요
            console.log("7번 카드 발동: 문양을 변경합니다.");
            break;
        case 11: // J (다음 사람 건너뛰기)
            console.log(`J 발동! 다음 플레이어를 건너뜁니다.`);
            currentshape = card.shape;
            return 'skip';
        case 12: // Q (방향 전환)
            undirection = !undirection;
            console.log(`Q 발동! 플레이 방향이 ${undirection ? '반시계' : '시계'}방향으로 바뀝니다.`);
            break;
        case 13: // K (한 번 더 턴 진행)
            console.log(`K 발동! 카드를 한 번 더 낼 수 있습니다.`);
            currentshape = card.shape;
            return 'keep_turn';
    }
    currentshape = card.shape;
}
// ※ 규칙: 다중(동시) 제출 미사용 (한 턴에는 오직 1장의 카드만 낼 수 있음)

//==================================
//  종료 판단 파트 - 원카드, 파산, 종료
//==================================

function checkonecard(playerIndex) {
    // 해당 플레이어의 원카드 상태만 갱신 (다른 플레이어 상태에는 영향 없음)
    const player = playerzone[playerIndex];
    if (player.hand.length === 1) {
        player.onecard = true;
        console.log(`[원카드!] 플레이어 ${player.id}가 패가 1장 남았습니다!`);
        // TODO: 제한 시간 내에 "원카드" 버튼을 누르지 못했을 경우 감점/드로우 처리 로직 추가
    } else {
        player.onecard = false;
    }
    return player.onecard;
}

function bankrupt(playerIndex) {
    // 패가 15장 이상인 경우 파산 및 탈락 처리
    const player = playerzone[playerIndex];
    if (!player || player.isEliminated) return false;

    if (player.hand.length >= 15) {
        player.isEliminated = true;
        player.onecard = false;
        console.log(`[파산] 플레이어 ${player.id}의 패가 15장 이상(${player.hand.length}장)이 되어 탈락했습니다!`);
        
        // 파산 플레이어의 패는 덱 고갈 방지를 위해 버린 카드 더미(submitzoneCards) 아래쪽에 회수
        if (player.hand.length > 0) {
            submitzoneCards.unshift(...player.hand);
            player.hand = [];
        }
        return true;
    }
    return false;
}

function gameover() {
    // 1. 패가 0장이 된 생존 플레이어 승리 검사
    for (let i = 0; i < playerzone.length; i++) {
        const player = playerzone[i];
        if (!player.isEliminated && player.hand.length === 0) {
            console.log(`[게임 종료] 승리자 발생: 플레이어 ${player.id}! (패 0장 달성)`);
            return { isOver: true, winner: player.id, reason: 'card_cleared' };
        }
    }

    // 2. 파산 검사 (15장 이상 보유한 미탈락자 탈락 처리)
    for (let i = 0; i < playerzone.length; i++) {
        bankrupt(i);
    }

    // 3. 생존 플레이어 수 확인
    const activePlayers = playerzone.filter(p => !p.isEliminated);

    // 남은 플레이어가 1명이면 그 플레이어가 최후의 승자!
    if (activePlayers.length === 1) {
        const winner = activePlayers[0];
        console.log(`[게임 종료] 다른 모든 플레이어 파산 탈락! 최후의 생존자: 플레이어 ${winner.id} 승리!`);
        return { isOver: true, winner: winner.id, reason: 'last_survivor' };
    }

    // 모든 플레이어가 동시 파산한 예외 경우
    if (activePlayers.length === 0) {
        console.log(`[게임 종료] 모든 플레이어가 파산했습니다. (무승부)`);
        return { isOver: true, winner: null, reason: 'draw' };
    }

    return { isOver: false };
}

function nextturn(stepCount = 1){
// turn 넘겨 진행시키는 함수
// 1. 탈락하지 않은 생존 플레이어만 순회
// 2. K카드의 경우 한 번 더 차례 진행 (playCard에서 유지)
// 3. Q카드의 경우 플레이 방향 전환
// 4. J카드의 경우 생존자 기준 다다음 플레이어로 넘김 (stepCount=2)
// 5. 차례가 끝나면 다음 플레이어로 전환

    const activePlayers = playerzone.filter(p => !p.isEliminated);
    if (activePlayers.length <= 1) {
        // 생존자가 1명 이하면 더 이상 턴을 넘기지 않음
        return;
    }

    const step = undirection ?  -1 : 1;
    const count = playerzone.length;

    let stepsLeft = stepCount;
    let nextIndex = currentturn;

    // 탈락하지 않은 플레이어를 만날 때마다 1단계씩 전진
    while (stepsLeft > 0) {
        nextIndex = (((nextIndex + step) % count) + count) % count;
        if (!playerzone[nextIndex].isEliminated) {
            stepsLeft--;
        }
    }

    currentturn = nextIndex;
    draw = false;
    endturn = false;
    console.log(`다음 턴: Player ${currentturn + 1} (P${currentturn + 1})`);
}
/*

function checksubmit(){
// submitzone에 플레이어가 선택한 카드가 제출 가능한지 검증하는 함수
// 1. submitzone에 맨위 카드와 모양이 같거나 같은 숫자만 제출 가능
// 2. 공격 상황에서 받아칠 수 있는 상황인지 조건 체크
}



function checkspecialcard(){
// K, Q, J, A, 2, 3, 7, 컬러 조커, 흑백 조커 체크 및 능력 적용 함수.
// 1. K 한번 더 카드 제출 
// 2. Q 플레이 순서 반대반향으로 전환
// 3. J 다음 순서 플레이어 턴 건너뛰고 그 다음 플레이어 턴으로 전환
// 4. 7 현재 카드의 문양을 원하는 걸로 바꿀 수 있음
// 5. A 다음 플레이어에게 3장 공격
// 6. 2 다음 플레이어에게 2장 공격
// 7. 3 2카드로 공격 받았을 때 방어가 가능
// 8. 컬조 다음 플레이어에게 7장 공격
// 9. 흑조 다음 플레이어에게 5장 공격
} 

function multiplecard(){
// 누적되는 카드 체크 함수
// 1. 공격카드 누적 체크
// 2카드는 2,A,컬조,흑조로 공격 누적, 3으로 방어 가능
// A카드는 A,컬조,흑조로 공격 누적
// 흑조는 컬조로 공격 누적
// 컬조는 위에 누적 불가
// 공격카드가 나오고 이후에 누적이나 방어 못하는 플레이어 나오면 누적된 공격 한꺼번에 받음
// 2. 중복숫자 누적 체크
// A~K까지 모든 숫자, 그리고 조커 2장은 숫자가 같으면 내고 싶은 만큼 누적 가능  
// 특수 카드가 누적되는 경우 공격카드랑 다르게 한장씩 능력 적용
}


//==================================
//  종료 판단 파트 - 원카드, 파산, 종료
//==================================
function checkonecard(){
// 원카드 체크 함수
// 1. 패에 카드가 한장 있는지
// 2. 원카드를 다른 플레이어들보다 먼저 외쳤는지
// 다른 플레이어들이 먼저 외쳤다면 1장 드로우
}

function bankrupt(){
// 패에 카드가 15장 이상인 경우 파산 체크 함수
// 1. 공격으로 인해 패 15장 이상
// 2. 과도한 드로우로 인한 패 15장 이상
}

function gameover(){
// 게임 종료 검사 함수
// 1. checkonecard 함수로 원카드 상황 체크
// 2. 패에 카드가 0장 되는 플레이어 체크 후 게임 종료    
}
*/