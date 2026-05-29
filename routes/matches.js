const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const db = require('../database');

const router = express.Router();

// Get match history for current user
router.get('/history', authMiddleware, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const matches = db.getMatchHistory(req.user.id, limit);
    res.json(matches);
});

// Get specific match details
router.get('/:id', authMiddleware, (req, res) => {
    const match = db.getMatch(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    // Only allow participants to view match details
    if (match.player1_id !== req.user.id && match.player2_id !== req.user.id) {
        return res.status(403).json({ error: 'Not your match' });
    }

    res.json(match);
});

module.exports = router;
