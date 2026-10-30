const express = require('express');
const http = require('http');
const {Server} = require('socket.io');
const path = require('path');
const { REFUSED } = require('dns');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {cors:{origin: "*",methods: ["GET", "POST"]}});

const OneCardGame = require('./back.js');

// 방 상태 브로드캐스트 헬퍼 함수
function broadcastGameState(roomId) {
  const room = rooms[roomId];
  if (!room || !room.game) return;

  const publicState = room.game.getPublicState();

  // 모든 인원에게 기본 상태 전달
  io.to(roomId).emit('gameStateUpdate', publicState);

  // 본인 손패(카드 목록)는 해당 소켓에게만 비공개 개별 전송
  room.game.playerzone.forEach(p => {
    io.to(p.socketId).emit('myHandUpdate', p.hand);
  });
}

// 게임 종료 처리 공통 헬퍼 함수
function handleGameEnd(roomId, overResult) {
  const room = rooms[roomId];
  if (!room) return;

  const winnerPlayer = room.game ? room.game.playerzone.find(p => p.id === overResult.winner) : null;
  io.to(roomId).emit('gameOver', {
    ...overResult,
    winnerName: winnerPlayer ? winnerPlayer.name : overResult.winner
  });

  room.isPlaying = false;
  room.game = null;

  // 게임 도중 퇴장(null)한 자리 정리 및 관전자 승격
  room.players = room.players.filter(Boolean);
  while (room.spectators.length > 0 && room.players.length < MAX_PLAYERS) {
    room.players.push(room.spectators.shift());
  }

  room.players.forEach((p, i) => { p.id = `P${i + 1}`; });
  room.spectators.forEach((s, i) => { s.id = `관전자${i + 1}`; });

  io.to(roomId).emit('roomStateUpdated', {
    players: room.players,
    spectators: room.spectators,
    hostId: room.hostId
  });
  io.emit('roomListUpdated', getPublicRoomInfo());
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'practice.html'));
});
app.use(express.static(__dirname));

const MAX_PLAYERS = 4;// 방에 초대 입장 플레이어수
const MAX_CAPACITY = 6;// 방에 최대 입장 인원수
const rooms = {}; // 방 배열
let players = []; // 플레이어 리스트
let spectators = []; // 관전자 리스트
let roomCounter = 1001;// 방 번호 시작점
let lobbyUsers=[];//로비에 있는 플레이어 리스트


//1.전체 소켓 처리
// 방 생성, 입장, 퇴장, 게임 시작으로 구성된 4가지 이벤트 처리
io.on('connection',(socket) => {

    //유저 접속 시
    console.log(`신규 접속: ${socket.id}`);
    socket.currentRoomId = null;

    //플레이어명 전달
    lobbyUsers.push({ socketId: socket.id, name: '플레이어' });
    io.emit('lobbyUsersUpdated', lobbyUsers);

    //로비 유저 목록 업데이트
    socket.on('setUserName',(name)=>{
        const user = lobbyUsers.find(u => u.socketId == socket.id);
        if(user){
            user.name = name;
            io.emit('lobbyUsersUpdated',lobbyUsers);
        }
    }); 
    
    //방 목록 요청 처리 
    socket.on('getRoomList', () => {
        socket.emit('roomListResponse',getPublicRoomInfo());

    });

    //새 방 만들기 요청
    socket.on('createRoom', ({ title, playerName }) => {
        const newRoomId = String(roomCounter++);
        
        //방정보
        rooms[newRoomId] = {
            id: newRoomId,
            title: title || `방 ${newRoomId}`,
            hostId: socket.id,
            players: [{ socketId: socket.id, id: 'P1', name: playerName || '플레이어' }],
            spectators: [],
            isPlaying:false
        };

        socket.currentRoomId = newRoomId;
        socket.join(newRoomId);

        socket.emit('joinRoomSuccess',{roomId: newRoomId, myRole:'P1',roomData: rooms[newRoomId]});
        io.emit('roomListUpdated',getPublicRoomInfo());
    });

    //기존 방 입장하기 요청
    socket.on('joinRoom',({roomId,playerName})=>{
        const room =rooms[roomId];
        if(!room){
            return socket.emit('errorMsg', '존재하지 않는 방이에요');
        }

        if (room.isPlaying) {
            return socket.emit('errorMsg', '이미 게임이 시작된 방이에요.');
        }

        const total = room.players.length + room.spectators.length;
        if(total >= MAX_CAPACITY){
            return socket.emit('errorMsg','방이 가득 찼어요');
        }

        let myRole ='';

        // 먼저온 4명에게 플레이어, 나머지 2명 관전자 부여
        if(room.players.length < MAX_PLAYERS){
            myRole =`P${room.players.length + 1}`;
            room.players.push({socketId:socket.id,id:myRole,name: playerName || '플레이어'});
        }else{
            myRole = `관전자${room.spectators.length + 1}`;
            room.spectators.push({socketId:socket.id, id:myRole,name: playerName || '플레이어'});
        }
        
        socket.currentRoomId =roomId;
        socket.join(roomId);

        // 입장 성공 전달 및 모든 상태 업데이트
        socket.emit('joinRoomSuccess',{roomId: roomId, myRole: myRole, roomData: rooms[roomId]});
        io.to(roomId).emit('roomStateUpdated', { players: room.players, spectators: room.spectators,hostId: room.hostId });
        io.emit('roomListUpdated',getPublicRoomInfo());
    
    });

    //대기실에서 로비로 나가기 버튼 처리
    socket.on('leaveRoom',() =>{
        processUserExit(socket);
    });

    //접속 해제 처리 
    socket.on('disconnect',() => {
        console.log(`접속 해제: ${socket.id}`);
        processUserExit(socket);
        lobbyUsers = lobbyUsers.filter(u=>u.socketId!=socket.id);
        io.emit('lobbyUsersUpdated',lobbyUsers);
    });

    //게임 시작 처리
    socket.on('startGame',() =>{
        const roomId = socket.currentRoomId;
        if(!roomId || !rooms[roomId]) return;
        
        const room = rooms[roomId];
        if(room.hostId !== socket.id){
             return socket.emit('errorMsg','방장만 게임 시작할 수 있어요');
        }

        if(room.players.length < MAX_PLAYERS){
            return socket.emit('errorMsg', '플레이어가 4명 모두 채워져야 시작할 수 있어요.');
        }

        room.isPlaying = true;
        room.game = new OneCardGame(room.players);

        //게임 시작시 전달 정보
        io.to(roomId).emit('gameStart', {
            players: room.players,
            spectators: room.spectators,
            hostId: room.hostId
        });

        broadcastGameState(roomId);
        io.emit('roomListUpdated', getPublicRoomInfo());

    });

    // 인게임: 카드 제출 처리
    socket.on('playCard', ({ cardIndex, newShape } = {}) => {
        const roomId = socket.currentRoomId;
        const room = roomId && rooms[roomId];
        if (!room || !room.isPlaying || !room.game) return;

        const result = room.game.playCard(socket.id, cardIndex, newShape);
        if (!result.success) {
            return socket.emit('errorMsg', result.msg);
        }

        broadcastGameState(roomId);
        if (result.overResult && result.overResult.isOver) {
            handleGameEnd(roomId, result.overResult);
        }
    });

    // 인게임: 카드 뽑기 처리
    socket.on('drawCard', () => {
        const roomId = socket.currentRoomId;
        const room = roomId && rooms[roomId];
        if (!room || !room.isPlaying || !room.game) return;

        const result = room.game.drawCard(socket.id);
        if (!result.success) {
            return socket.emit('errorMsg', result.msg);
        }

        broadcastGameState(roomId);
        if (result.overResult && result.overResult.isOver) {
            handleGameEnd(roomId, result.overResult);
        }
    });

    // 인게임: 원카드 외치기 처리
    socket.on('callOneCard', () => {
        const roomId = socket.currentRoomId;
        const room = roomId && rooms[roomId];
        if (!room || !room.isPlaying || !room.game) return;

        const result = room.game.callOneCard(socket.id);
        if (!result.success) {
            return socket.emit('errorMsg', result.msg);
        }

        io.to(roomId).emit('oneCardResult', result);
        broadcastGameState(roomId);
        if (result.overResult && result.overResult.isOver) {
            handleGameEnd(roomId, result.overResult);
        }
    });
    
});

// 2. 방 목록 정보 추출 함수 (로비 화면용)
// 방 id, 제목, 방장, 플레이어 수, 관전자 수, 총 참가자 수, 가득찼는지 여부, 게임 중 여부  
function getPublicRoomInfo() {
    const list = [];
    for (const id in rooms) {
        const r = rooms[id];
        const validPlayers = r.players.filter(Boolean);
        const host = validPlayers.find(p => p.socketId === r.hostId)|| r.spectators.find(s => s.socketId === r.hostId);
        const totalMembers = validPlayers.length + r.spectators.length;
        list.push({
            id: r.id,
            title: r.title,
            hostName: host ? host.name : '방장',
            playerCount: validPlayers.length,
            specCount: r.spectators.length,
            memberCount: totalMembers,
            isFull: totalMembers >= MAX_CAPACITY,
            isPlaying: r.isPlaying || false
        });
    }
    return list;
}


// 3.유저가 방 나가거나 끊겼을 떄 실행 공통함수
// 접속해제 시 플레이어라면 관전자 중 한 명 플레이어로 승격, 관전자라면 관전자 재정렬
// 마지막 플레이어가 나가면 방 삭제 및 동기화
function processUserExit(socket){

        const currentRoomId = socket.currentRoomId;
        if (!currentRoomId || !rooms[currentRoomId]) {
            return;
        }

        const target = rooms[currentRoomId];
        socket.leave(currentRoomId);
        socket.currentRoomId = null;

        const wasHost = (target.hostId === socket.id);

        // 플레이어 퇴장처리
        const playerId = target.players.findIndex(p => p && p.socketId === socket.id);
        let leaveResult = null;
        if(playerId != -1){
            if(target.isPlaying){
                //아직 게임 종료 함수 안만들어져서 null로 플레이어 안 꼬이게 설정
                target.players[playerId] = null;
                if (target.game) {
                    leaveResult = target.game.handlePlayerLeave(socket.id);
                }
            }else{
                target.players.splice(playerId,1);

                // 관전자 -> 플레이어로 승격
                if(target.spectators.length > 0 && target.players.length < MAX_PLAYERS){
                    const nextplayer = target.spectators.shift();
                    target.players.push(nextplayer);
                }
            }
         }else{// 관전자 퇴장처리
            const specId = target.spectators.findIndex(s => s.socketId === socket.id);
            if (specId !== -1) {
                target.spectators.splice(specId, 1);
            }
        }

        target.players.forEach((p, i) => { if (p) p.id = `P${i + 1}`; });
        target.spectators.forEach((s, i) => { s.id = `관전자${i + 1}`; });
       

        // 방에 아무도 없으면 방삭제 아니면 플레이어 상태 동기화
        const activePlayersCount = target.players.filter(Boolean).length;
        const totalRemain = activePlayersCount + target.spectators.length;
        
        if (totalRemain === 0) {
            delete rooms[currentRoomId];
            console.log(`방 삭제됨: ${currentRoomId}`);
        } else {
            const validPlayers = target.players.filter(Boolean);
            const hostStillExists = [...validPlayers, ...target.spectators].some(m => m.socketId === target.hostId);
            if (wasHost || !hostStillExists) {
                if (validPlayers.length > 0) {
                    target.hostId = validPlayers[0].socketId; // 남은 플레이어 중 첫 번째 사람에게 위임
                } else if (target.spectators.length > 0) {
                    target.hostId = target.spectators[0].socketId; // 플레이어가 없으면 관전자 중 첫 번째 사람에게 위임
                }
            }

            if (target.isPlaying && target.game) {
                if (leaveResult && leaveResult.overResult && leaveResult.overResult.isOver) {
                    handleGameEnd(currentRoomId, leaveResult.overResult);
                } else {
                    broadcastGameState(currentRoomId);
                    io.to(currentRoomId).emit('roomStateUpdated', {
                        players: target.players.filter(Boolean),
                        spectators: target.spectators,
                        hostId: target.hostId
                    });
                }
            } else {
                io.to(currentRoomId).emit('roomStateUpdated', {
                    players: target.players.filter(Boolean),
                    spectators: target.spectators,
                    hostId: target.hostId
                });
            }
        }

        io.emit('roomListUpdated', getPublicRoomInfo());

}


server.listen(3000, () => {
    console.log('서버가 3000번 포트에서 실행 중입니다.');
});
