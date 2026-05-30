const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const db = require('../database');
const { getRank } = require('../matchmaking/elo');

const router = express.Router();

// Get current user profile
router.get('/me', authMiddleware, (req, res) => {
    const user = req.user;
    const rank = getRank(user.elo);
    res.json({
        ...user,
        coins: user.coins || 0,
        attributes: user.attributes || { speed: 60, shooting: 60, dunking: 60, defense: 60 },
        rank,
        winRate: user.matches_played > 0
            ? Math.round((user.wins / user.matches_played) * 100)
            : 0
    });
});

// Update profile
router.patch('/me', authMiddleware, (req, res) => {
    const { display_name, bio, parsec_link, skin } = req.body;

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

    const updated = db.updateUser(req.user.id, { display_name, bio, parsec_link, skin });
    const rank = getRank(updated.elo);
    res.json({ ...updated, rank });
});

// Get another user's profile
router.get('/:id', authMiddleware, (req, res) => {
    const user = db.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rank = getRank(user.elo);
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
        rankTier: getRank(p.elo),
        winRate: p.matches_played > 0
            ? Math.round((p.wins / p.matches_played) * 100)
            : 0
    })));
});

// Upgrade Attribute
router.post('/upgrade', authMiddleware, (req, res) => {
    const { attribute } = req.body;
    const user = req.user;
    
    if (!attribute || !['speed', 'shooting', 'dunking', 'defense'].includes(attribute)) {
        return res.status(400).json({ error: 'Invalid attribute' });
    }

    const currentLevel = user.attributes ? user.attributes[attribute] : 60;
    if (currentLevel >= 99) {
        return res.status(400).json({ error: 'Attribute is maxed out' });
    }

    // Cost logic, e.g., 100 coins per upgrade
    const cost = 100;
    const coins = user.coins || 0;

    if (coins < cost) {
        return res.status(400).json({ error: 'Not enough coins' });
    }

    // Deduct coins
    const updatedWithCoins = db.deductCoins(user.id, cost);
    if (!updatedWithCoins) {
         return res.status(400).json({ error: 'Failed to deduct coins' });
    }

    // Upgrade stat
    const updatedUser = db.updateUserAttributes(user.id, attribute);
    res.json({ success: true, coins: updatedUser.coins, attributes: updatedUser.attributes });
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
