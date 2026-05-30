const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const db = require('../database');

const router = express.Router();

// Discord OAuth2 URL generator
router.get('/discord/url', (req, res) => {
    const params = new URLSearchParams({
        client_id: config.discord.clientId,
        redirect_uri: config.discord.redirectUri,
        response_type: 'code',
        scope: 'identify guilds.join'
    });
    res.json({ url: `https://discord.com/api/oauth2/authorize?${params}` });
});

// Discord OAuth2 callback
router.get('/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'No code provided' });

    try {
        // Exchange code for token
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: config.discord.clientId,
                client_secret: config.discord.clientSecret,
                grant_type: 'authorization_code',
                code,
                redirect_uri: config.discord.redirectUri
            })
        });

        const tokenData = await tokenRes.json();
        if (tokenData.error) {
            return res.status(400).json({ error: 'Discord auth failed', details: tokenData.error });
        }

        // Get user info
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const discordUser = await userRes.json();

        // Force Join Discord Server
        if (config.discord.guildId && config.discord.botToken) {
            try {
                const joinRes = await fetch(`https://discord.com/api/guilds/${config.discord.guildId}/members/${discordUser.id}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bot ${config.discord.botToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        access_token: tokenData.access_token
                    })
                });
                
                if (joinRes.status === 201 || joinRes.status === 204) {
                    console.log(`[AUTH] Added user ${discordUser.username} to guild (or already in guild).`);
                } else {
                    const joinData = await joinRes.json();
                    console.error('[AUTH] Failed to add user to guild:', joinData);
                }
            } catch (e) {
                console.error('[AUTH] Exception adding user to guild:', e.message);
            }
        }

        // Check if user exists, create if not
        let user = db.getUserByDiscord(discordUser.id);
        if (!user) {
            user = db.createUser({
                id: uuidv4(),
                discord_id: discordUser.id,
                discord_username: discordUser.username,
                discord_avatar: discordUser.avatar
                    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
                    : null,
                parsec_link: null
            });
        } else {
            // Update Discord info on login
            db.updateUser(user.id, {
                discord_username: discordUser.username,
                discord_avatar: discordUser.avatar
                    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
                    : null
            });
            user = db.getUser(user.id);
        }

        // Try to assign Matchmaking role via bot
        try {
            const { assignMatchmakingRole } = require('../discord/bot');
            await assignMatchmakingRole(discordUser.id);
        } catch (e) {
            console.log('[AUTH] Could not assign role (bot might not be ready):', e.message);
        }

        // Generate JWT
        const token = jwt.sign({ userId: user.id, discordId: discordUser.id }, config.jwtSecret, {
            expiresIn: '30d'
        });

        // Redirect back to the Electron app with the token
        res.redirect(`https://2k17-matchmaking-server.onrender.com/auth/success?token=${token}`);
    } catch (err) {
        console.error('[AUTH] Discord OAuth error:', err);
        res.status(500).json({ error: 'Auth failed' });
    }
});

// Auth success page - Electron app reads the token from this
router.get('/success', (req, res) => {
    const { token } = req.query;
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>2K17 Revival - Connected!</title>
        <style>
            body { background: #0a0a0f; color: #fff; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .container { text-align: center; }
            h1 { color: #a855f7; font-size: 24px; }
            p { color: #888; }
            .token { display: none; }
        </style>
        </head>
        <body>
            <div class="container">
                <h1>✅ Discord Connected!</h1>
                <p>You can close this window and return to 2K17 Revival.</p>
                <div class="token" id="token">${token}</div>
            </div>
            <script>
                // Send token back to Electron via custom protocol or postMessage
                if (window.opener) {
                    window.opener.postMessage({ type: '2k17_auth', token: '${token}' }, '*');
                }
            </script>
        </body>
        </html>
    `);
});

module.exports = router;
