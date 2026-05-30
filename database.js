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

const default2KStats = {
    close_shot: 57, driving_layup: 44, driving_dunk: 25, standing_dunk: 26, post_hook: 30,
    mid_range: 61, three_point: 61, free_throw: 63, post_fade: 63,
    pass_accuracy: 44, ball_handle: 42, post_control: 29,
    interior_def: 38, perimeter_def: 44, lateral_quickness: 44, steal: 30, block: 29, off_rebound: 29, def_rebound: 29
};

function createUser({ id, discord_id, discord_username, discord_avatar, parsec_link }) {
    const user = {
        id, discord_id, discord_username, discord_avatar, 
        display_name: discord_username, parsec_link,
        elo: config.matchmaking.eloDefault,
        wins: 0, losses: 0, matches_played: 0, is_banned: 0,
        coins: 0,
        affiliation: null,
        rep_exp: 0,
        rep_level: 1,
        unlocked_skins: ['default'],
        attributes: { ...default2KStats },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    db.users.push(user);
    save();
    return user;
}

function getUser(id) {
    const user = db.users.find(u => u.id === id);
    if (user && !user.builds) {
        user.builds = [{
            id: 'build_1',
            name: 'MyPlayer',
            archetype: 'Balanced',
            attributes: { ...default2KStats },
            skin: user.skin || 'default'
        }];
        user.active_build_id = 'build_1';
        save();
    } else if (user && user.builds) {
        // Ensure legacy builds get the 20 stats
        for (let b of user.builds) {
            if (b.attributes && Object.keys(b.attributes).length < 5) {
                b.attributes = { ...default2KStats };
                save();
            }
        }
    }

    if (user && user.affiliation === undefined) {
        user.affiliation = null;
        user.rep_exp = 0;
        user.rep_level = 1;
        user.unlocked_skins = ['default'];
        save();
    }
    return user;
}

function getUserByDiscord(discord_id) {
    return db.users.find(u => u.discord_id === discord_id);
}

function updateUser(id, fields) {
    const user = getUser(id);
    if (!user) return null;

    const allowed = ['display_name', 'bio', 'parsec_link', 'discord_avatar', 'discord_username', 'affiliation'];
    for (const key of allowed) {
        if (fields[key] !== undefined) {
            user[key] = fields[key];
        }
    }
    if (fields.skin !== undefined) {
        // Update skin on the active build instead of root
        const activeBuild = user.builds.find(b => b.id === user.active_build_id);
        if (activeBuild) activeBuild.skin = fields.skin;
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
    
    const activeBuild = user.builds.find(b => b.id === user.active_build_id);
    if (!activeBuild) return null;

    if (!activeBuild.attributes) activeBuild.attributes = { speed: 60, shooting: 60, dunking: 60, defense: 60 };

    if (activeBuild.attributes[attribute] !== undefined) {
        activeBuild.attributes[attribute] += 1;
        user.updated_at = new Date().toISOString();
        save();
        return user;
    }
    return null;
}

// ── Build Operations ──
function createBuild(id, name, archetype) {
    const user = getUser(id);
    if (!user) return null;

    if (user.builds.length >= 5) return { error: 'Max 5 builds allowed' };

    const newBuild = {
        id: 'build_' + Date.now(),
        name: name || 'New Build',
        archetype: archetype || 'Balanced',
        attributes: { ...default2KStats },
        skin: 'default'
    };

    user.builds.push(newBuild);
    user.active_build_id = newBuild.id;
    user.updated_at = new Date().toISOString();
    save();
    return user;
}

function setActiveBuild(userId, buildId) {
    const user = getUser(userId);
    if (!user) return null;

    if (user.builds.find(b => b.id === buildId)) {
        user.active_build_id = buildId;
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

function grantExp(user, amount) {
    if (!user || user.rep_level >= 100) return;
    user.rep_exp += amount;
    while (user.rep_exp >= 100 && user.rep_level < 100) {
        user.rep_exp -= 100;
        user.rep_level += 1;
        if (!user.unlocked_skins) user.unlocked_skins = ['default'];
        user.unlocked_skins.push('tier_' + user.rep_level);
    }
}

function completeMatch(matchId, winnerId) {
    const match = getMatch(matchId);
    if (match) {
        match.winner_id = winnerId;
        match.status = 'completed';
        match.completed_at = new Date().toISOString();
        
        const loserId = (match.player1_id === winnerId) ? match.player2_id : match.player1_id;
        
        // Winner Rewards
        const winner = getUser(winnerId);
        if (winner) {
            winner.coins = (winner.coins || 0) + 500;
            winner.elo += 500;
            grantExp(winner, 50);
            winner.wins += 1;
            winner.matches_played += 1;
        }

        // Loser Rewards
        const loser = getUser(loserId);
        if (loser) {
            loser.coins = (loser.coins || 0) + 100;
            grantExp(loser, 50);
            loser.losses += 1;
            loser.matches_played += 1;
        }
        
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
    updateUserAttributes, addCoins, deductCoins, createBuild, setActiveBuild,
    createMatch, getMatch, getActiveMatch, reportResult, completeMatch, cancelMatch, getMatchHistory
};
