const express = require('express');
const http = require('http');
const {Server} = require('socket.io');
const path = require('path');
const { REFUSED } = require('dns');

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
let roomCounter = 1001;// 방 번호 시작점



//1.전체 소켓 처리
// 방 생성, 입장, 퇴장, 게임 시작으로 구성된 4가지 이벤트 처리
io.on('connection',(socket) => {

    //유저 접속 시
    console.log(`신규 접속: ${socket.id}`);
    socket.currentRoomId = null;
    
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
            return socket.emit('errorMg', '존재하지 않는 방이에요');
        }

        if (room.isPlaying) {
            return socket.emit('errorMsg', '이미 게임이 시작된 방이에요.');
        }

        const total = room.players.length + room.spectators.length;
        if(total >= MAX_CAPACITY){
            return socket.emit('errorMg','방이 가득 찼어요');
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
    });

    //게임 시작 처리
    socket.on('startGame',() =>{
        const roomId = socket.currentRoomId;
        if(!roomId || !rooms[roomId]) return;
        
        const room = rooms[roomId];
        if(room.hostId !== socket.id){
             return socket.emit('errorMg','방장만 게임 시작할 수 있어요');
        }

        if(room.players.length < MAX_PLAYERS){
            return socket.emit('errorMsg', '플레이어가 4명 모두 채워져야 시작할 수 있어요.');
        }

        room.isPlaying = true;

        //게임 시작시 전달 정보
        io.to(roomId).emit('gameStart', {
            players: room.players,
            spectators: room.spectators,
            hostId: room.hostId
        });

        io.emit('roomListUpdated', getPublicRoomInfo());

    });
});

// 2. 방 목록 정보 추출 함수 (로비 화면용)
// 방 id, 제목, 방장, 플레이어 수, 관전자 수, 총 참가자 수, 가득찼는지 여부, 게임 중 여부  
function getPublicRoomInfo() {
    const list = [];
    for (const id in rooms) {
        const r = rooms[id];
        const host = r.players.find(p => p.socketId === r.hostId)|| r.spectators.find(s => s.socketId === r.hostId);
        const totalMembers = r.players.length + r.spectators.length;
        list.push({
            id: r.id,
            title: r.title,
            hostName: host ? host.name : '방장',
            playerCount: r.players.length,
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
        const playerId = target.players.findIndex(p => p.socketId === socket.id);
        if(playerId != -1){
            target.players.splice(playerId,1);

            // 관전자 -> 플레이어로 승격
            if(target.spectators.length > 0 && target.players.length < MAX_PLAYERS){
                const nextplayer = target.spectators.shift();
                target.players.push(nextplayer);
            }
         }else{// 관전자 퇴장처리
            const specId = target.spectators.findIndex(s => s.socketId === socket.id);
            if (specId !== -1) {
                target.spectators.splice(specId, 1);
            }
        }

        target.players.forEach(((p,i) => {p.id = `P${i + 1}`;}));
        target.spectators.forEach((s, i) => { s.id = `관전자${i + 1}`; });
       

        // 방에 아무도 없으면 방삭제 아니면 플레이어 상태 동기화
        const totalRemain =target.players.length + target.spectators.length;
        if (totalRemain === 0) {
            delete rooms[currentRoomId];
            console.log(`방 삭제됨: ${currentRoomId}`);
        } else {
            const hostStillExists = [...target.players, ...target.spectators].some(m => m.socketId === target.hostId);
            if (wasHost || !hostStillExists) {
                if (target.players.length > 0) {
                    target.hostId = target.players[0].socketId; // 남은 플레이어 중 첫 번째 사람에게 위임
                } else if (target.spectators.length > 0) {
                    target.hostId = target.spectators[0].socketId; // 플레이어가 없으면 관전자 중 첫 번째 사람에게 위임
                }
            }
            
            io.to(currentRoomId).emit('roomStateUpdated', {
                players: target.players,
                spectators: target.spectators,
                hostId: target.hostId
            });
        }

        io.emit('roomListUpdated', getPublicRoomInfo());

}


server.listen(3000, () => {
    console.log('서버가 3000번 포트에서 실행 중입니다.');
});
