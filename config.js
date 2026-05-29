require('dotenv').config();

module.exports = {
    port: parseInt(process.env.PORT) || 3000,
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',

    discord: {
        clientId: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        botToken: process.env.DISCORD_BOT_TOKEN,
        guildId: process.env.DISCORD_GUILD_ID,
        redirectUri: process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/auth/discord/callback',
        matchmakingRoleName: 'Matchmaking'
    },

    matchmaking: {
        queueTimeoutMs: parseInt(process.env.QUEUE_TIMEOUT_MS) || 15 * 60 * 1000, // 15 min default
        eloDefault: 1000,
        eloKFactor: 32
    }
};
