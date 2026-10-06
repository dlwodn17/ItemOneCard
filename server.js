const express = require('express');
const http = require('http');
const {Server} = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {cors:{origin: "*",methods: ["GET", "POST"]}});


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'practice.html'));
});
app.use(express.static(__dirname));

const MAX_PLAYERS = 4;// 방에 초대 입장 플레이어수
const MAX_CAPACITY = 6;// 방에 최대 입장 인원수
const rooms = {}; // 방 배열
let players = []; // 플레이어 리스트
let spectators = []; // 관전자 리스트
let roomCounter = 1;// 방 개수

//============================================
// 입장 가능한 방 찾거나 없으면 새 방 생성하는 함수
//============================================
function createRoom(){
    //기존 방들 중 자리 있는 방 탐색
    for(const roomId in rooms){
        const r = rooms[roomId];
        const total = r.players.length + r.spectators.length;
        if(total < MAX_CAPACITY){
            return roomId;
        }
    }
    // 방 없으면 방 id 생성
    const newRoomId = `room_${roomCounter++}`;
    rooms[newRoomId] = { players: [], spectators: [] };
    return newRoomId;
}



//===================================================
// 접속 및 퇴장 처리 - 풀방 6명(플레이어4 관전2)
//===================================================
io.on('connection',(socket) => {
    console.log(`신규 접속: ${socket.id}`);
    // 방생성
    const roomId = createRoom();
    const room = rooms[roomId];

    socket.roomId = roomId;
    socket.join(roomId);

    let myRole ='';

    // 먼저온 4명에게 플레이어, 나머지 2명 관전자 부여
    if(room.players.length < MAX_PLAYERS){
        myRole =`P${room.players.length + 1}`;
        room.players.push({socketId:socket.id,id:myRole});
    }else{
        myRole = `관전자 ${room.spectators.length + 1}`;
        room.spectators.push({socketId:socket.id, id:myRole});
    }

    //접속자에게 역할 전달 - 플레이어, 관전자
    socket.emit('initRole',{myRole, roomId});
    io.to(roomId).emit('userStateUpdated',{
        players: room.players,
        spectators: room.spectators
    });

    //접속 해제 처리 - 접속해제 시 플레이어라면 관전자 중 한 명 플레이어로 승격, 관전자라면 관전자 재정렬
    socket.on('disconnect',() => {
        console.log(`접속 해제: ${socket.id}`);

        const currentRoomId = socket.roomId;
        if (!currentRoomId || !rooms[currentRoomId]) {
            return;
        }

        const target = rooms[currentRoomId];
        // 플레이어 퇴장처리
        const playerId = target.players.findIndex(p => p.socketId === socket.id);
        if(playerId != -1){
            target.players.splice(playerId,1);
            // 관전자 -> 플레이어로 승격
            if(target.spectators.length > 0 && target.players.length < MAX_PLAYERS){
                const nextplayer = target.spectators.shift();
                target.players.push(nextplayer);
            }
            // 재정렬
            target.players.forEach(((p,i) => {p.id = `P${i + 1}`;}));
            target.spectators.forEach((s, i) => { s.id = `관전자 ${i + 1}`; });
        }else{// 관전자 퇴장처리
            const specId = target.spectators.findIndex(s => s.socketId === socket.id);
            if (specId !== -1) {
                target.spectators.splice(specId, 1);
                target.spectators.forEach((s, i) => { s.id = `관전자 ${i + 1}`; });
            }
        }

        // 방에 아무도 없으면 방삭제 아니면 플레이어 상태 동기화
        const totalRemain =target.players.length + target.spectators.length;
        if (totalRemain === 0) {
            delete rooms[currentRoomId];
            console.log(`방 삭제됨: ${currentRoomId}`);
        } else {
            io.to(currentRoomId).emit('userStateUpdated', {
                players: target.players,
                spectators: target.spectators
            });
        }
       
    });
});



//==================================================
// 유저 간 소통 - 소켓을 이용한 유저 간 채팅
//==================================================
function chatmessage(){
    // 같은 방 내에서 플레이어 간 소통
    // roomId랑 userid 받아와서 소켓으로 메시지 전송
    // io.to(roomId).emit('chatMessage', ...) 
}




//====================================================
// 방 부가적인 기능 -  방 이동, 방 조회 등등
//====================================================
function moveRoom(){
    // 기존 방 퇴장처리 (인원 감소, 승격, 재정렬, 빈 방 삭제)
    // 새 방 지정 혹은 자동 생성 배정 (없거나 꽉 차면 createRoom으로 새 방 자동 배정)
    // 새 방 역할 부여 및 상태 업데이트 
}

function searchRoom(){
    // 전체 방 목록 리스트 
    // 방마다 플레이어 수, 관전자 수 풀방 여부 표시
}


server.listen(3000, () => {
    console.log('서버가 3000번 포트에서 실행 중입니다.');
});