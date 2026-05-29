const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const config = require('./config');
const db = require('./database');
const QueueManager = require('./matchmaking/queue');
const { socketAuth } = require('./middleware/auth');
const { initBot } = require('./discord/bot');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const matchRoutes = require('./routes/matches');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middleware
app.use(cors());
app.use(express.json());

// Init database
db.init();

// REST routes
app.use('/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/matches', matchRoutes);

// Health check
app.get('/health', (req, res) => {
    const queue = queueManager.getQueueSizes();
    res.json({
        status: 'online',
        uptime: process.uptime(),
        queue
    });
});

// ── Socket.io matchmaking ──

io.use(socketAuth);

const queueManager = new QueueManager(io);

// Track connected sockets by userId
const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log(`[WS] ${socket.user.display_name} connected`);
    connectedUsers.set(socket.userId, socket.id);

    // Send initial queue sizes
    socket.emit('queue_sizes', queueManager.getQueueSizes());

    // ── Join queue ──
    socket.on('join_queue', (data) => {
        const { mode, hasGame } = data; // '1v1' or '2v2'
        const result = queueManager.addToQueue(mode, socket.userId, socket.id, hasGame);

        if (result.error) {
            socket.emit('queue_error', { error: result.error });
        } else if (result.waiting) {
            socket.emit('queue_joined', { mode, position: result.queueSize });
        }
        // If matched, match_found event is already sent by QueueManager

        // Broadcast updated queue sizes
        io.emit('queue_sizes', queueManager.getQueueSizes());
    });

    // ── Leave queue ──
    socket.on('leave_queue', () => {
        const result = queueManager.removeFromQueue(socket.id);
        if (result.removed) {
            socket.emit('queue_left', { mode: result.mode });
        }
        io.emit('queue_sizes', queueManager.getQueueSizes());
    });

    // ── Report match result ──
    socket.on('report_result', (data) => {
        const { matchId, winnerId } = data;
        const result = queueManager.reportMatchResult(matchId, socket.userId, winnerId);

        if (result.error) {
            socket.emit('result_error', { error: result.error });
        } else if (result.reported) {
            socket.emit('result_reported', { awaitingOther: true });
        } else if (result.completed) {
            // Notify both players
            const p1Socket = connectedUsers.get(result.winner.id);
            const p2Socket = connectedUsers.get(result.loser.id);

            const payload = { type: 'match_completed', result };

            if (p1Socket) io.to(p1Socket).emit('match_result', payload);
            if (p2Socket) io.to(p2Socket).emit('match_result', payload);
        } else if (result.disputed) {
            socket.emit('match_disputed', { matchId });
        }
    });

    // ── Cancel match ──
    socket.on('cancel_match', () => {
        const result = queueManager.cancelMatchByUser(socket.userId);
        if (result.cancelled) {
            socket.emit('match_cancelled', { matchId: result.matchId });
        }
    });

    // ── Disconnect ──
    socket.on('disconnect', () => {
        console.log(`[WS] ${socket.user.display_name} disconnected`);
        queueManager.removeFromQueue(socket.id);
        connectedUsers.delete(socket.userId);
        io.emit('queue_sizes', queueManager.getQueueSizes());
    });
});

// ── Start server ──

async function start() {
    // Init Discord bot (non-blocking)
    initBot().catch(err => console.error('[BOT] Init error:', err.message));

    server.listen(config.port, () => {
        console.log('');
        console.log('  ╔══════════════════════════════════════╗');
        console.log('  ║   2K17 MATCHMAKING REVIVAL SERVER    ║');
        console.log('  ╠══════════════════════════════════════╣');
        console.log(`  ║   HTTP:   http://localhost:${config.port}      ║`);
        console.log(`  ║   WS:     ws://localhost:${config.port}        ║`);
        console.log('  ║   Status: ONLINE ✅                  ║');
        console.log('  ╚══════════════════════════════════════╝');
        console.log('');
    });
}

start();
