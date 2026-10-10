const targetX=400;// 중앙
const targetY=400; // 중앙



let deck = []; 
// 54장 트럼프 카드(하트, 스페이드, 클로버, 다이아 각각 13장, 조커 2장)
let suffle = false; // 덱이 섞였는지 여부
let draw = false; // 드로우 했는지 여부
let endturn = false; // 차례가 끝났는지 여부 
let onecard = false; // 패에 카드 1장인지 여부
let undirection = false; // 플레이 방향 (false: 시계방향, true:반시계방향)
let currentshape = null; // 현재 카드 문양
let currentturn = 0; // 현재 누구 턴인지 
let attackstack = 0; // 공격 누적


const submitzone = new PIXI.Graphics();
let submitzoneCards = [];
// 내려고하는 카드 제출되는 곳
const deckzone = new PIXI.Graphics();
// 덱 더미 위치
const playerzone = [ // 플레이어들 위치, 패
    {id: 'P1', hand: []},
    {id: 'P2', hand: []},
    {id: 'P3', hand: []},
    {id: 'P4', hand: []}
];

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


function init(){
// 카드 초기화 및 초기 세팅 
// 1. 처음에 카드 값들 덱에 임의 순서로 생성
// 2. 처음에 submitzone에 임의카드 1장 세팅
// 3. 게임 시작하고 플레이어들에게 패로 7장 카드 뿌려줌 
   

    currentturn = 0;
    attackstack = 0;
    undirection = false;
    currentshape = null;
    submitzoneCards = [];
    playerzone.forEach(player => player.hand = []);

    createcard();
    sufflecard();


    if(deck.length > 0){
        const initialCard = deck.pop();
        submitzoneCards.push(initialCard);
        currentshape = initialCard.shape;
    }

    for(let i = 0; i < 7; i++){
        for(let j = 0; j < 4; j++){
            if(deck.length >0){
                playerzone[j].hand.push(deck.pop());
            }
        }
    }
}


//=====================================================
//  게임 플레이 파트 - 드로우, 제출, 턴, 특수 카드, 카드 누적
//=====================================================
function drawcard(){
// 덱에서 드로우하는 함수
// 1. 자신의 차례에 낼 수 있는 카드 없을 때 드로우
// 덱을 클릭하면 제일 위에 한장 패로 추가
// 2. 상대방의 공격으로 인한 드로우
// A 3장 , 2 2장, 컬러조커 7장, 흑백조커 5장
    const drawcount = attackstack > 0 ? attackstack : 1;
    for(let i = 0; i < drawcount; i++ ){
        if(deck.length==0){
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

    if (submitzoneCards.length === 0) return false;
    const topCard = submitzoneCards[submitzoneCards.length - 1];

    // 조커를 내는 경우
    if (card.type === 'joker') {
        // 공격 누적 중인 경우
        if (attackstack > 0) {
            // 컬조는 아무 때나 방어/누적 가능, 흑조는 2/A/흑조/컬조 공격에 대응 가능 여부 체크
            return true;
        }
        return true;
    }

    // 일반 카드 제출 조건
    // 1) 공격 누적 중인 경우의 방어/추가 공격 카드 체크
    if (attackstack > 0) {
        return canDefendOrStack(card, topCard);
    }

    // 2) 일반 상황: 맨 위 카드와 숫자가 같거나, 문양이 같거나, 현재 지정된 문양(currentshape)과 같은 경우
    const matchesNumber = (card.number === topCard.number);
    const matchesShape = (card.shape === topCard.shape || card.shape === currentshape);

    return matchesNumber || matchesShape;
}

function canDefendOrStack(card, topCard) {
    // 공격 상황에서의 규칙 처리
    // A: 3장 공격, 2: 2장 공격, 흑조: 5장, 컬조: 7장
    if (topCard.number === 2) {
        // 2의 공격은 2, A, 흑조, 컬조로 누적 가능, 3으로 방어 가능
        if (card.number === 3) return true; // 방어
        if (card.number === 2 || card.number === 1 || card.type === 'joker') return true;
    } else if (topCard.number === 1) { // A
        // A의 공격은 A, 흑조, 컬조로 누적 가능
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
            const step = undirection ? -1 : 1;
            currentturn = (currentturn + step * 2 + 4) % 4;
            console.log(`J 발동! 다다음 플레이어로 턴이 넘어갑니다.`);
            return; // 일반 nextturn의 턴 증가를 상쇄하기 위해 직접 리턴 처리 가능
        case 12: // Q (방향 전환)
            undirection = !undirection;
            console.log(`Q 발동! 플레이 방향이 ${undirection ? '반시계' : '시계'}방향으로 바뀝니다.`);
            break;
        case 13: // K (한 번 더 턴 진행)
            console.log(`K 발동! 카드를 한 번 더 낼 수 있습니다.`);
            // 현재 턴을 유지하기 위해 nextturn 호출을 건너뛰는 방식으로 처리
            return 'keep_turn';
    }
    currentshape = card.shape;
}

function multiplecard(selectedCards) {
    // 다중 카드 제출 (중복 숫자 누적) 처리
    // 같은 숫자의 카드를 여러 장 냈을 때의 검증 및 적용
    if (!selectedCards || selectedCards.length === 0) return false;
    
    const firstNumber = selectedCards[0].number;
    for (let i = 1; i < selectedCards.length; i++) {
        if (selectedCards[i].number !== firstNumber && selectedCards[i].type !== 'joker') {
            return false; // 숫자가 다르면 동시 제출 불가
        }
    }
    return true;
}


//==================================
//  종료 판단 파트 - 원카드, 파산, 종료
//==================================

function checkonecard(playerIndex) {
    const player = playerzone[playerIndex];
    if (player.hand.length === 1) {
        onecard = true;
        console.log(`[원카드!] 플레이어 ${player.id}가 패가 1장 남았습니다!`);
        // TODO: 제한 시간 내에 "원카드" 버튼을 누르지 못했을 경우 감점/드로우 처리 로직 추가
    } else {
        onecard = false;
    }
}

function bankrupt(playerIndex) {
    // 패가 15장 이상인 경우 파산 체크
    const player = playerzone[playerIndex];
    if (player.hand.length >= 15) {
        console.log(`[파산] 플레이어 ${player.id}의 패가 15장을 초과하여 파산했습니다!`);
        return true;
    }
    return false;
}

function gameover() {
    // 1. 패가 0장이 된 플레이어가 있는지 검사
    for (let i = 0; i < playerzone.length; i++) {
        if (playerzone[i].hand.length === 0) {
            console.log(`[게임 종료] 승리자 발생: 플레이어 ${playerzone[i].id}!`);
            return { isOver: true, winner: playerzone[i].id };
        }
        // 2. 파산 플레이어 체크
        if (bankrupt(i)) {
            console.log(`[게임 종료] 플레이어 ${playerzone[i].id} 파산으로 인한 탈락`);
            return { isOver: true, bankruptPlayer: playerzone[i].id };
        }
    }
    return { isOver: false };
}

/*

function checksubmit(){
// submitzone에 플레이어가 선택한 카드가 제출 가능한지 검증하는 함수
// 1. submitzone에 맨위 카드와 모양이 같거나 같은 숫자만 제출 가능
// 2. 공격 상황에서 받아칠 수 있는 상황인지 조건 체크
}

function nextturn(){
// turn 넘겨 진행시키는 함수
// 1. 현재 누구 차례인지 검증
// 2. K카드의 경우 한 번 더 차례 진행
// 3. Q카드의 경우 플레이 방향 전환
// 4. J카드의 경우 다다음 플레이어 차례로 넘김
// 5. 차례가 끝나면 다음 플레이어로 전환

    const step = undirection ?  -1 : 1;
    curentturn = (curentturn + step + 4) % 4;
    draw = false;
    endturn = false;
    console.log(`다음 턴: Player ${currentturn + 1} (P${currentturn + 1})`);
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