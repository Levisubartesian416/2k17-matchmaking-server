const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');
const config = require('../config');

let client = null;
let ready = false;

async function initBot() {
    if (!config.discord.botToken) {
        console.log('[BOT] No bot token configured, skipping Discord bot');
        return;
    }

    client = new Client({
        intents: [GatewayIntentBits.Guilds]
    });

    client.once('ready', () => {
        ready = true;
        console.log(`[BOT] Logged in as ${client.user.tag}`);
    });

    try {
        await client.login(config.discord.botToken);
    } catch (err) {
        console.error('[BOT] Failed to login:', err.message);
    }
}

async function assignMatchmakingRole(discordUserId) {
    if (!client || !ready) throw new Error('Bot not ready');

    const guild = await client.guilds.fetch(config.discord.guildId);
    if (!guild) throw new Error('Guild not found');

    const member = await guild.members.fetch(discordUserId);
    if (!member) throw new Error('Member not found in guild');

    // Find or create the Matchmaking role
    let role = guild.roles.cache.find(r => r.name === config.discord.matchmakingRoleName);
    if (!role) {
        role = await guild.roles.create({
            name: config.discord.matchmakingRoleName,
            color: '#a855f7',
            reason: '2K17 Revival matchmaking role'
        });
        console.log(`[BOT] Created "${config.discord.matchmakingRoleName}" role`);
    }

    if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role);
        console.log(`[BOT] Assigned "${config.discord.matchmakingRoleName}" role to ${member.user.tag}`);
    }

    return true;
}

async function createDisputeTicket(matchId, p1DiscordId, p2DiscordId) {
    if (!client || !ready) {
        console.error('[BOT] Bot not ready to create dispute ticket');
        return;
    }

    try {
        const guild = await client.guilds.fetch(config.discord.guildId);
        if (!guild) return;

        // Ensure category exists
        let category = guild.channels.cache.find(c => c.name === 'Disputes' && c.type === ChannelType.GuildCategory);
        if (!category) {
            category = await guild.channels.create({
                name: 'Disputes',
                type: ChannelType.GuildCategory
            });
        }

        // Create the ticket channel
        const channelName = `dispute-${matchId.split('-')[0]}`; // use short id
        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: guild.id, // @everyone
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: p1DiscordId, // Player 1
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: p2DiscordId, // Player 2
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: client.user.id, // Bot itself
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                }
            ]
        });

        // Send the initial message
        await channel.send(
            `🚨 **MATCH DISPUTE** 🚨\n\n<@${p1DiscordId}> and <@${p2DiscordId}>\n\nBoth of you reported winning match \`${matchId}\`.\nPlease provide a screenshot or video of the final scoreboard here.\n\nAdmins will review the proof and manually assign the win. If you do not provide proof within 15 minutes, you may forfeit the match or receive a ban.`
        );

        console.log(`[BOT] Created dispute ticket: #${channelName}`);
    } catch (err) {
        console.error('[BOT] Error creating dispute ticket:', err.message);
    }
}

function getClient() { return client; }
function isReady() { return ready; }

module.exports = { initBot, assignMatchmakingRole, createDisputeTicket, getClient, isReady };
