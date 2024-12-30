const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// 게임방 관리
const rooms = new Map();

function createRoom(roomCode) {
    return {
        code: roomCode,
        host: null,
        maxPlayers: 5,
        roles: [
            { name: "당첨", count: 3 },
            { name: "꽝", count: 2 }
        ],
        players: new Map(), // { playerId: { id, ws, joinTime } }
        gameStarted: false
    };
}

// 랜덤 방 코드 생성 (4자리)
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms.has(code));
    return code;
}

// 모든 웹소켓 연결 관리
wss.on('connection', (ws, req) => {
    const playerId = Date.now().toString();
    let currentRoom = null;

    console.log('New connection established');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message type:', data.type);
            
            switch (data.type) {
                case 'createRoom': {
                    const roomCode = generateRoomCode();
                    console.log('Creating new room with code:', roomCode);
                    
                    const newRoom = createRoom(roomCode);
                    newRoom.host = playerId;
                    newRoom.players.set(playerId, { 
                        id: playerId, 
                        ws: ws,
                        joinTime: Date.now()
                    });
                    
                    rooms.set(roomCode, newRoom);
                    currentRoom = newRoom;
                    
                    console.log('Current rooms:', Array.from(rooms.keys()));
                    
                    ws.send(JSON.stringify({
                        type: 'roomCreated',
                        roomCode: roomCode,
                        playerId: playerId,
                        isHost: true
                    }));
                    
                    broadcastGameState(newRoom);
                    break;
                }

                case 'joinRoom': {
                    console.log('Join room attempt. Code:', data.roomCode);
                    console.log('Available rooms:', Array.from(rooms.keys()));
                    
                    const roomCode = data.roomCode.toString();
                    const room = rooms.get(roomCode);
                    
                    if (!room) {
                        console.log('Room not found:', roomCode);
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: '존재하지 않는 방 코드입니다.'
                        }));
                        return;
                    }

                    if (room.gameStarted) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: '이미 게임이 시작된 방입니다.'
                        }));
                        return;
                    }

                    if (room.players.size >= room.maxPlayers) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: '방이 가득 찼습니다.'
                        }));
                        return;
                    }

                    room.players.set(playerId, { 
                        id: playerId, 
                        ws: ws,
                        joinTime: Date.now()
                    });
                    currentRoom = room;
                    
                    console.log('Player joined room:', roomCode);
                    
                    ws.send(JSON.stringify({
                        type: 'roomJoined',
                        roomCode: roomCode,
                        playerId: playerId,
                        isHost: playerId === room.host
                    }));

                    broadcastGameState(room);
                    break;
                }

                case 'leaveRoom': {
                    if (currentRoom) {
                        const roomCode = currentRoom.code;
                        console.log('Player leaving room:', roomCode);
                        
                        currentRoom.players.delete(playerId);
                        
                        if (playerId === currentRoom.host && currentRoom.players.size > 0) {
                            const oldestPlayer = Array.from(currentRoom.players.values())
                                .sort((a, b) => a.joinTime - b.joinTime)[0];
                            currentRoom.host = oldestPlayer.id;
                        }
                        
                        if (currentRoom.players.size === 0) {
                            console.log('Removing empty room:', roomCode);
                            rooms.delete(roomCode);
                        } else {
                            broadcastGameState(currentRoom);
                        }
                        currentRoom = null;
                    }
                    break;
                }

                case 'updateSettings': {
                    if (currentRoom && data.playerId === currentRoom.host) {
                        console.log('Updating room settings');
                        currentRoom.maxPlayers = data.maxPlayers;
                        currentRoom.roles = data.roles;
                        broadcastGameState(currentRoom);
                    }
                    break;
                }

                case 'startGame': {
                    if (currentRoom && data.playerId === currentRoom.host && !currentRoom.gameStarted) {
                        console.log('Starting game in room:', currentRoom.code);
                        currentRoom.gameStarted = true;
                        
                        const players = Array.from(currentRoom.players.keys());
                        const assignments = new Map();
                        
                        // 모든 역할 할당을 위한 배열 생성
                        let allRoles = [];
                        currentRoom.roles.forEach(role => {
                            for (let i = 0; i < role.count; i++) {
                                allRoles.push(role.name);
                            }
                        });

                        // 남은 플레이어 수만큼 역할 무작위 선택
                        for (let i = 0; i < players.length; i++) {
                            const randomIndex = Math.floor(Math.random() * allRoles.length);
                            assignments.set(players[i], allRoles[randomIndex]);
                            allRoles.splice(randomIndex, 1);
                        }
                        
                        // 결과 전송
                        currentRoom.players.forEach((playerData, pid) => {
                            if (playerData.ws.readyState === WebSocket.OPEN) {
                                playerData.ws.send(JSON.stringify({
                                    type: 'gameResult',
                                    role: assignments.get(pid)
                                }));
                            }
                        });
                        
                        broadcastGameState(currentRoom);
                    }
                    break;
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Connection closed for player:', playerId);
        if (currentRoom) {
            currentRoom.players.delete(playerId);
            
            if (playerId === currentRoom.host && currentRoom.players.size > 0) {
                const oldestPlayer = Array.from(currentRoom.players.values())
                    .sort((a, b) => a.joinTime - b.joinTime)[0];
                currentRoom.host = oldestPlayer.id;
            }
            
            if (currentRoom.players.size === 0) {
                console.log('Removing empty room:', currentRoom.code);
                rooms.delete(currentRoom.code);
            } else {
                broadcastGameState(currentRoom);
            }
        }
    });

    ws.playerId = playerId;
});

function broadcastGameState(room) {
    const state = {
        type: 'gameState',
        roomCode: room.code,
        maxPlayers: room.maxPlayers,
        roles: room.roles,
        currentPlayers: room.players.size,
        gameStarted: room.gameStarted,
        hostId: room.host
    };
    
    console.log('Broadcasting game state for room:', room.code);
    
    room.players.forEach((playerData) => {
        if (playerData.ws.readyState === WebSocket.OPEN) {
            playerData.ws.send(JSON.stringify({
                ...state,
                isHost: playerData.id === room.host
            }));
        }
    });
}

const PORT = process.env.PORT || 2000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Available IP addresses:');
    getIPAddresses().forEach(ip => {
        console.log(`  http://${ip}:${PORT}`);
    });
});

function getIPAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    
    for (const interfaceName in interfaces) {
        const interface = interfaces[interfaceName];
        for (const address of interface) {
            if (address.family === 'IPv4' && !address.internal) {
                addresses.push(address.address);
            }
        }
    }
    
    return addresses;
}