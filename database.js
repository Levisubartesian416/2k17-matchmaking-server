const fs = require('fs');
const path = require('path');
const config = require('./config');

const DB_PATH = path.join(__dirname, 'matchmaking.json');

let db = {
    users: [],
    matches: []
};

function init() {
    if (fs.existsSync(DB_PATH)) {
        try {
            db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        } catch (e) {
            console.error('Failed to load DB, starting fresh');
        }
    }
    save();
    console.log('[DB] JSON Database initialized');
    return db;
}

function save() {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ── User operations ──

function createUser({ id, discord_id, discord_username, discord_avatar, parsec_link }) {
    const user = {
        id, discord_id, discord_username, discord_avatar, 
        display_name: discord_username, parsec_link,
        elo: config.matchmaking.eloDefault,
        wins: 0, losses: 0, matches_played: 0, is_banned: 0,
        coins: 0,
        attributes: { speed: 60, shooting: 60, dunking: 60, defense: 60 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    db.users.push(user);
    save();
    return user;
}

function getUser(id) {
    return db.users.find(u => u.id === id);
}

function getUserByDiscord(discord_id) {
    return db.users.find(u => u.discord_id === discord_id);
}

function updateUser(id, fields) {
    const user = getUser(id);
    if (!user) return null;

    const allowed = ['display_name', 'bio', 'parsec_link', 'discord_avatar', 'discord_username', 'skin'];
    for (const key of allowed) {
        if (fields[key] !== undefined) {
            user[key] = fields[key];
        }
    }
    user.updated_at = new Date().toISOString();
    save();
    return user;
}

function updateUserStats(id, { elo, wins, losses, matches_played }) {
    const user = getUser(id);
    if (user) {
        user.elo = elo;
        user.wins = wins;
        user.losses = losses;
        user.matches_played = matches_played;
        user.updated_at = new Date().toISOString();
        save();
    }
}

function banUser(id, banned) {
    const user = getUser(id);
    if (user) {
        user.is_banned = banned ? 1 : 0;
        save();
    }
}

function updateUserAttributes(id, attribute) {
    const user = getUser(id);
    if (!user) return null;
    
    // Ensure attributes object exists for legacy users
    if (!user.attributes) user.attributes = { speed: 60, shooting: 60, dunking: 60, defense: 60 };

    if (user.attributes[attribute] !== undefined) {
        user.attributes[attribute] += 1;
        user.updated_at = new Date().toISOString();
        save();
        return user;
    }
    return null;
}

function addCoins(id, amount) {
    const user = getUser(id);
    if (!user) return null;
    
    user.coins = (user.coins || 0) + amount;
    user.updated_at = new Date().toISOString();
    save();
    return user;
}

function deductCoins(id, amount) {
    const user = getUser(id);
    if (!user) return null;
    
    if ((user.coins || 0) >= amount) {
        user.coins -= amount;
        user.updated_at = new Date().toISOString();
        save();
        return user;
    }
    return null;
}

function getLeaderboard(limit = 10) {
    return db.users
        .filter(u => !u.is_banned)
        .sort((a, b) => b.elo - a.elo)
        .slice(0, limit);
}

// ── Match operations ──

function createMatch({ id, mode, player1_id, player2_id, host_id }) {
    const match = {
        id, mode, player1_id, player2_id, host_id,
        winner_id: null, player1_reported: null, player2_reported: null,
        status: 'active',
        created_at: new Date().toISOString(),
        completed_at: null
    };
    db.matches.push(match);
    save();
    return match;
}

function getMatch(id) {
    return db.matches.find(m => m.id === id);
}

function getActiveMatch(userId) {
    return db.matches.find(m => 
        (m.player1_id === userId || m.player2_id === userId) && 
        m.status === 'active'
    );
}

function reportResult(matchId, reporterId, winnerId) {
    const match = getMatch(matchId);
    if (!match) return null;

    if (match.player1_id === reporterId) {
        match.player1_reported = winnerId;
    } else if (match.player2_id === reporterId) {
        match.player2_reported = winnerId;
    }
    save();
    return match;
}

function completeMatch(matchId, winnerId) {
    const match = getMatch(matchId);
    if (match) {
        match.winner_id = winnerId;
        match.status = 'completed';
        match.completed_at = new Date().toISOString();
        save();
    }
    return match;
}

function cancelMatch(matchId) {
    const match = getMatch(matchId);
    if (match) {
        match.status = 'cancelled';
        save();
    }
}

function getMatchHistory(userId, limit = 10) {
    const matches = db.matches
        .filter(m => (m.player1_id === userId || m.player2_id === userId) && m.status === 'completed')
        .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
        .slice(0, limit);

    return matches.map(m => {
        const u1 = getUser(m.player1_id);
        const u2 = getUser(m.player2_id);
        return {
            ...m,
            player1_name: u1.display_name, player1_avatar: u1.discord_avatar, player1_elo: u1.elo,
            player2_name: u2.display_name, player2_avatar: u2.discord_avatar, player2_elo: u2.elo
        };
    });
}

function getDB() {
    return db;
}

module.exports = {
    init, getDB,
    createUser, getUser, getUserByDiscord, updateUser, updateUserStats, banUser, getLeaderboard,
    updateUserAttributes, addCoins, deductCoins,
    createMatch, getMatch, getActiveMatch, reportResult, completeMatch, cancelMatch, getMatchHistory
};
