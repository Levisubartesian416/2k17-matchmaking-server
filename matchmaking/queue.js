const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const db = require('../database');
const { calculateElo } = require('./elo');
const { createDisputeTicket } = require('../discord/bot');

class QueueManager {
    constructor(io) {
        this.io = io;
        this.queues = {
            '1v1': new Map(), // odcketId -> { userId, socketId, queuedAt }
            '2v2': new Map()
        };
        this.activeMatches = new Map(); // matchId -> match data

        // Periodic cleanup of stale queue entries
        setInterval(() => this.cleanStaleEntries(), 30000);
    }

    addToQueue(mode, userId, socketId, hasGame = false) {
        const queue = this.queues[mode];
        if (!queue) return { error: 'Invalid mode' };

        // Check if already in any queue
        for (const [m, q] of Object.entries(this.queues)) {
            for (const [sid, entry] of q) {
                if (entry.userId === userId) {
                    return { error: `Already in ${m} queue` };
                }
            }
        }

        // Check if in active match and auto-cancel it if they are stuck
        const activeMatch = db.getActiveMatch(userId);
        if (activeMatch) {
            console.log(`[QUEUE] Auto-canceling stuck match for ${userId}`);
            this.cancelMatchByUser(userId);
        }

        // Check if banned
        const user = db.getUser(userId);
        if (!user || user.is_banned) {
            return { error: 'Account is banned from matchmaking' };
        }

        queue.set(socketId, {
            userId,
            socketId,
            hasGame,
            queuedAt: Date.now()
        });

        console.log(`[QUEUE] ${user.display_name} joined ${mode} queue (${queue.size} in queue) (hasGame: ${hasGame})`);

        // Try to find a match
        return this.tryMatch(mode);
    }

    removeFromQueue(socketId) {
        for (const [mode, queue] of Object.entries(this.queues)) {
            if (queue.has(socketId)) {
                const entry = queue.get(socketId);
                queue.delete(socketId);
                console.log(`[QUEUE] Player left ${mode} queue (${queue.size} remaining)`);
                return { removed: true, mode };
            }
        }
        return { removed: false };
    }

    removeUserFromQueues(userId) {
        for (const [mode, queue] of Object.entries(this.queues)) {
            for (const [socketId, entry] of queue) {
                if (entry.userId === userId) {
                    queue.delete(socketId);
                    return true;
                }
            }
        }
        return false;
    }

    tryMatch(mode) {
        const queue = this.queues[mode];

        if (mode === '1v1' && queue.size >= 2) {
            const entries = Array.from(queue.entries());
            const [socket1, player1] = entries[0];
            const [socket2, player2] = entries[1];

            queue.delete(socket1);
            queue.delete(socket2);

            return this.createMatch(mode, player1, player2);
        }

        if (mode === '2v2' && queue.size >= 4) {
            // 2v2: grab 4 players, split into 2 teams
            const entries = Array.from(queue.entries()).slice(0, 4);
            for (const [sid] of entries) queue.delete(sid);
            // For now, return waiting - 2v2 is more complex, implement later
            return { waiting: true, queueSize: queue.size };
        }

        return { waiting: true, queueSize: queue.size };
    }

    createMatch(mode, player1Entry, player2Entry) {
        const user1 = db.getUser(player1Entry.userId);
        const user2 = db.getUser(player2Entry.userId);

        if (!user1 || !user2) return { error: 'Player not found' };

        // Select host based on who has the game
        let hostIsPlayer1;
        if (player1Entry.hasGame && !player2Entry.hasGame) {
            hostIsPlayer1 = true;
        } else if (!player1Entry.hasGame && player2Entry.hasGame) {
            hostIsPlayer1 = false;
        } else {
            // If both have it (or neither, though tryMatch prevents neither), pick randomly
            hostIsPlayer1 = Math.random() > 0.5;
        }

        const host = hostIsPlayer1 ? user1 : user2;
        const guest = hostIsPlayer1 ? user2 : user1;

        const matchId = uuidv4();
        const match = db.createMatch({
            id: matchId,
            mode,
            player1_id: user1.id,
            player2_id: user2.id,
            host_id: host.id
        });

        const matchData = {
            matchId,
            mode,
            host: {
                id: host.id,
                displayName: host.display_name,
                avatar: host.discord_avatar,
                elo: host.elo,
                parsecLink: host.parsec_link
            },
            guest: {
                id: guest.id,
                displayName: guest.display_name,
                avatar: guest.discord_avatar,
                elo: guest.elo,
                parsecLink: guest.parsec_link
            }
        };

        this.activeMatches.set(matchId, {
            ...matchData,
            player1Socket: player1Entry.socketId,
            player2Socket: player2Entry.socketId
        });

        // Notify both players
        this.io.to(player1Entry.socketId).emit('match_found', {
            ...matchData,
            yourRole: host.id === user1.id ? 'host' : 'guest'
        });

        this.io.to(player2Entry.socketId).emit('match_found', {
            ...matchData,
            yourRole: host.id === user2.id ? 'host' : 'guest'
        });

        console.log(`[MATCH] Created ${mode} match: ${user1.display_name} vs ${user2.display_name} (Host: ${host.display_name})`);

        return { matched: true, matchId, matchData };
    }

    reportMatchResult(matchId, reporterId, winnerId) {
        const match = db.reportResult(matchId, reporterId, winnerId);
        if (!match) return { error: 'Match not found' };

        // Check if both players reported the same winner
        if (match.player1_reported && match.player2_reported) {
            if (match.player1_reported === match.player2_reported) {
                return this.finalizeMatch(matchId, match.player1_reported);
            } else {
                // Dispute - for now, cancel the match and create a Discord ticket
                db.cancelMatch(matchId);
                this.activeMatches.delete(matchId);

                // Create Discord ticket
                const p1 = db.getUser(match.player1_id);
                const p2 = db.getUser(match.player2_id);
                if (p1 && p2 && p1.discord_id && p2.discord_id) {
                    createDisputeTicket(matchId, p1.discord_id, p2.discord_id);
                }

                return { disputed: true, matchId };
            }
        }

        return { reported: true, awaitingOther: true };
    }

    finalizeMatch(matchId, winnerId) {
        const match = db.getMatch(matchId);
        const loserId = match.player1_id === winnerId ? match.player2_id : match.player1_id;

        const winner = db.getUser(winnerId);
        const loser = db.getUser(loserId);

        // Calculate new ELO
        const newElo = calculateElo(winner.elo, loser.elo);

        // Update stats
        db.updateUserStats(winnerId, {
            elo: newElo.winner,
            wins: winner.wins + 1,
            losses: winner.losses,
            matches_played: winner.matches_played + 1
        });

        db.updateUserStats(loserId, {
            elo: newElo.loser,
            wins: loser.wins,
            losses: loser.losses + 1,
            matches_played: loser.matches_played + 1
        });

        db.completeMatch(matchId, winnerId);
        this.activeMatches.delete(matchId);

        const result = {
            completed: true,
            matchId,
            winner: { id: winnerId, name: winner.display_name, oldElo: winner.elo, newElo: newElo.winner },
            loser: { id: loserId, name: loser.display_name, oldElo: loser.elo, newElo: newElo.loser }
        };

        console.log(`[MATCH] Completed: ${winner.display_name} (${winner.elo} → ${newElo.winner}) beat ${loser.display_name} (${loser.elo} → ${newElo.loser})`);

        return result;
    }

    cancelMatchByUser(userId) {
        const match = db.getActiveMatch(userId);
        if (match) {
            db.cancelMatch(match.id);
            this.activeMatches.delete(match.id);
            return { cancelled: true, matchId: match.id };
        }
        return { cancelled: false };
    }

    cleanStaleEntries() {
        const now = Date.now();
        const timeout = config.matchmaking.queueTimeoutMs;

        for (const [mode, queue] of Object.entries(this.queues)) {
            for (const [socketId, entry] of queue) {
                if (now - entry.queuedAt > timeout) {
                    queue.delete(socketId);
                    this.io.to(socketId).emit('queue_timeout', { mode });
                    console.log(`[QUEUE] Timed out player from ${mode} queue`);
                }
            }
        }
    }

    getQueueSizes() {
        return {
            '1v1': this.queues['1v1'].size,
            '2v2': this.queues['2v2'].size
        };
    }
}

module.exports = QueueManager;
