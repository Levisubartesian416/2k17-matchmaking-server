const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const db = require('../database');
const { getRank } = require('../matchmaking/elo');
const { logActivity } = require('../discord/bot');

// Helper: compute OVR from attributes
function computeOvr(attrs) {
    if (!attrs) return 60;
    const vals = Object.values(attrs);
    if (vals.length === 0) return 60;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.min(99, Math.round(60 + Math.max(0, (avg - 41.4) * 0.677)));
}

const router = express.Router();

// Get current user profile
router.get('/me', authMiddleware, (req, res) => {
    const user = req.user;
    const rank = getRank(user.rep_level || 1);
    res.json({
        ...user,
        coins: user.coins || 0,
        rank,
        winRate: user.matches_played > 0
            ? Math.round((user.wins / user.matches_played) * 100)
            : 0
    });
});

// Update profile
router.patch('/me', authMiddleware, (req, res) => {
    const { display_name, bio, parsec_link, skin, affiliation } = req.body;

    // Validate parsec link format
    if (parsec_link !== undefined && parsec_link !== null && parsec_link !== '') {
        const parsecRegex = /^https:\/\/(parsec\.(app|gg)|web\.parsec\.app)\//i;
        if (!parsecRegex.test(parsec_link)) {
            return res.status(400).json({ error: 'Invalid Parsec link format' });
        }
    }

    if (display_name !== undefined && (display_name.length < 2 || display_name.length > 24)) {
        return res.status(400).json({ error: 'Display name must be 2-24 characters' });
    }

    if (bio !== undefined && bio.length > 200) {
        return res.status(400).json({ error: 'Bio must be under 200 characters' });
    }

    const updated = db.updateUser(req.user.id, { display_name, bio, parsec_link, skin, affiliation });
    const rank = getRank(updated.rep_level || 1);

    // Log skin change to Discord
    if (skin !== undefined) {
        const activeBuild = updated.builds && updated.builds.find(b => b.id === updated.active_build_id);
        logActivity('skin', {
            displayName: updated.display_name,
            avatar: updated.discord_avatar,
            skinName: skin,
            buildName: activeBuild ? activeBuild.name : 'MyPlayer'
        });
    }

    res.json({ ...updated, rank });
});

// Get another user's profile
router.get('/:id', authMiddleware, (req, res) => {
    const user = db.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rank = getRank(user.rep_level || 1);
    res.json({
        id: user.id,
        display_name: user.display_name,
        discord_avatar: user.discord_avatar,
        bio: user.bio,
        elo: user.elo,
        wins: user.wins,
        losses: user.losses,
        matches_played: user.matches_played,
        rank,
        winRate: user.matches_played > 0
            ? Math.round((user.wins / user.matches_played) * 100)
            : 0
    });
});

// Leaderboard
router.get('/leaderboard/top', authMiddleware, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const players = db.getLeaderboard(limit);
    res.json(players.map((p, i) => ({
        rank: i + 1,
        id: p.id,
        display_name: p.display_name,
        discord_avatar: p.discord_avatar,
        elo: p.elo,
        wins: p.wins,
        losses: p.losses,
        matches_played: p.matches_played,
        rankTier: getRank(p.rep_level || 1),
        winRate: p.matches_played > 0
            ? Math.round((p.wins / p.matches_played) * 100)
            : 0
    })));
});

// Upgrade Attribute
router.post('/upgrade', authMiddleware, (req, res) => {
    const { attribute } = req.body;
    const user = req.user;
    
    const validStats = [
        'close_shot', 'driving_layup', 'driving_dunk', 'standing_dunk', 'post_hook',
        'mid_range', 'three_point', 'free_throw', 'post_fade',
        'pass_accuracy', 'ball_handle', 'post_control',
        'interior_def', 'perimeter_def', 'lateral_quickness', 'steal', 'block', 'off_rebound', 'def_rebound',
        'speed', 'shooting', 'dunking', 'defense' // legacy support
    ];
    
    if (!attribute || !validStats.includes(attribute)) {
        return res.status(400).json({ error: 'Invalid attribute' });
    }

    const activeBuild = user.builds && user.builds.find(b => b.id === user.active_build_id);
    if (!activeBuild) return res.status(400).json({ error: 'No active build found' });

    const currentLevel = activeBuild.attributes ? activeBuild.attributes[attribute] : 60;
    if (currentLevel >= 99) {
        return res.status(400).json({ error: 'Attribute is maxed out' });
    }

    // Progressive Cost Logic (~500k to max)
    let cost = 300;
    if (currentLevel >= 71) cost = 500;
    if (currentLevel >= 81) cost = 800;
    if (currentLevel >= 91) cost = 1200;

    const coins = user.coins || 0;

    if (coins < cost) {
        return res.status(400).json({ error: `Not enough VC (Needs ${cost})` });
    }

    // Deduct coins
    const updatedWithCoins = db.deductCoins(user.id, cost);
    if (!updatedWithCoins) {
         return res.status(400).json({ error: 'Failed to deduct coins' });
    }

    // Upgrade stat
    const updatedUser = db.updateUserAttributes(user.id, attribute);
    const updatedActiveBuild = updatedUser.builds.find(b => b.id === updatedUser.active_build_id);

    // Log upgrade to Discord
    const newValue = updatedActiveBuild.attributes[attribute];
    const overall = computeOvr(updatedActiveBuild.attributes);
    logActivity('upgrade', {
        displayName: updatedUser.display_name,
        avatar: updatedUser.discord_avatar,
        attribute,
        newValue,
        overall,
        buildName: updatedActiveBuild.name || 'MyPlayer',
        cost
    });

    res.json({ success: true, coins: updatedUser.coins, attributes: updatedActiveBuild.attributes, active_build_id: updatedUser.active_build_id, overall });
});

// ── Build Management ──

router.post('/builds', authMiddleware, (req, res) => {
    const { name, archetype, position, height, weight } = req.body;
    const user = req.user;
    
    if (!name || name.length < 2 || name.length > 24) {
        return res.status(400).json({ error: 'Name must be 2-24 characters' });
    }

    const updatedUser = db.createBuild(user.id, name, archetype, position, height, weight);
    if (updatedUser.error) {
        return res.status(400).json({ error: updatedUser.error });
    }

    // Log build creation to Discord
    logActivity('build_create', {
        displayName: updatedUser.display_name,
        avatar: updatedUser.discord_avatar,
        buildName: name,
        archetype: archetype || 'Balanced',
        position: position || 'PG'
    });
    
    res.json({ success: true, user: updatedUser });
});

router.put('/builds/active', authMiddleware, (req, res) => {
    const { buildId } = req.body;
    const user = req.user;

    const updatedUser = db.setActiveBuild(user.id, buildId);
    if (!updatedUser) {
        return res.status(400).json({ error: 'Build not found' });
    }

    // Log build switch to Discord
    const activeBuild = updatedUser.builds.find(b => b.id === buildId);
    if (activeBuild) {
        logActivity('build_switch', {
            displayName: updatedUser.display_name,
            avatar: updatedUser.discord_avatar,
            buildName: activeBuild.name,
            overall: computeOvr(activeBuild.attributes)
        });
    }

    res.json({ success: true, user: updatedUser });
});

// Buy Coins (Mock Store)
router.post('/buy-coins', authMiddleware, (req, res) => {
    const { amount } = req.body;
    const user = req.user;

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    const updatedUser = db.addCoins(user.id, amount);
    res.json({ success: true, coins: updatedUser.coins });
});

module.exports = router;
