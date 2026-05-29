const config = require('../config');

const K = config.matchmaking.eloKFactor;

// Standard ELO calculation
function calculateElo(winnerElo, loserElo) {
    const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));

    const newWinnerElo = Math.round(winnerElo + K * (1 - expectedWinner));
    const newLoserElo = Math.round(loserElo + K * (0 - expectedLoser));

    return {
        winner: newWinnerElo,
        loser: Math.max(newLoserElo, 100) // floor at 100, don't let people go negative
    };
}

// Get rank title based on ELO
function getRank(elo) {
    if (elo >= 2000) return { name: 'Legend', emoji: '👑', color: '#FFD700' };
    if (elo >= 1700) return { name: 'Diamond', emoji: '💎', color: '#B9F2FF' };
    if (elo >= 1400) return { name: 'Platinum', emoji: '⚡', color: '#E5E4E2' };
    if (elo >= 1200) return { name: 'Gold', emoji: '🥇', color: '#FFD700' };
    if (elo >= 1000) return { name: 'Silver', emoji: '🥈', color: '#C0C0C0' };
    if (elo >= 800)  return { name: 'Bronze', emoji: '🥉', color: '#CD7F32' };
    return { name: 'Rookie', emoji: '🏀', color: '#808080' };
}

module.exports = { calculateElo, getRank };
