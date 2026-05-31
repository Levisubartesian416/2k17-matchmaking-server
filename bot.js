const { Client, GatewayIntentBits, ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');
const config = require('../config');

let client = null;
let ready = false;
let activityChannelId = null; // cached channel ID

async function initBot() {
    if (!config.discord.botToken) {
        console.log('[BOT] No bot token configured, skipping Discord bot');
        return;
    }

    client = new Client({
        intents: [GatewayIntentBits.Guilds]
    });

    client.once('ready', async () => {
        ready = true;
        console.log(`[BOT] Logged in as ${client.user.tag}`);
        // Pre-create the activity channel on boot
        await ensureActivityChannel();
    });

    try {
        await client.login(config.discord.botToken);
    } catch (err) {
        console.error('[BOT] Failed to login:', err.message);
    }
}

// ── Activity Channel ──

async function ensureActivityChannel() {
    if (!client || !ready) return null;
    if (activityChannelId) {
        try {
            const ch = await client.channels.fetch(activityChannelId);
            if (ch) return ch;
        } catch { /* channel deleted, recreate */ }
    }

    try {
        const guild = await client.guilds.fetch(config.discord.guildId);
        if (!guild) return null;

        // Find or create category
        let category = guild.channels.cache.find(c => c.name === '2K17 Revival' && c.type === ChannelType.GuildCategory);
        if (!category) {
            category = await guild.channels.create({
                name: '2K17 Revival',
                type: ChannelType.GuildCategory
            });
        }

        // Find or create channel
        let channel = guild.channels.cache.find(c => c.name === 'myplayer-activity' && c.parentId === category.id);
        if (!channel) {
            channel = await guild.channels.create({
                name: 'myplayer-activity',
                type: ChannelType.GuildText,
                parent: category.id,
                topic: '🏀 Live feed of MyPlayer changes — upgrades, skins, builds, matches'
            });
            console.log('[BOT] Created #myplayer-activity channel');
        }

        activityChannelId = channel.id;
        return channel;
    } catch (err) {
        console.error('[BOT] Error ensuring activity channel:', err.message);
        return null;
    }
}

/**
 * Log a MyPlayer activity event to the #myplayer-activity channel.
 * 
 * @param {'upgrade'|'skin'|'build_create'|'build_switch'|'match_start'|'match_end'|'purchase'} type
 * @param {object} data - Event-specific data
 */
async function logActivity(type, data) {
    if (!client || !ready) return;

    const channel = await ensureActivityChannel();
    if (!channel) return;

    let embed;

    try {
        switch (type) {
            case 'upgrade': {
                const statName = data.attribute.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                embed = new EmbedBuilder()
                    .setColor(0xF59E0B)
                    .setAuthor({ name: data.displayName, iconURL: data.avatar || undefined })
                    .setDescription(`⬆️ **${statName}** upgraded to **${data.newValue}**`)
                    .addFields(
                        { name: 'Build', value: data.buildName || 'MyPlayer', inline: true },
                        { name: 'Overall', value: `${data.overall} OVR`, inline: true },
                        { name: 'VC Spent', value: `🪙 ${data.cost}`, inline: true }
                    )
                    .setTimestamp();
                break;
            }
            case 'skin': {
                embed = new EmbedBuilder()
                    .setColor(0x8B5CF6)
                    .setAuthor({ name: data.displayName, iconURL: data.avatar || undefined })
                    .setDescription(`👕 Changed skin to **${data.skinName}**`)
                    .addFields(
                        { name: 'Build', value: data.buildName || 'MyPlayer', inline: true }
                    )
                    .setTimestamp();
                break;
            }
            case 'build_create': {
                embed = new EmbedBuilder()
                    .setColor(0x10B981)
                    .setAuthor({ name: data.displayName, iconURL: data.avatar || undefined })
                    .setDescription(`🆕 Created new build: **${data.buildName}**`)
                    .addFields(
                        { name: 'Archetype', value: data.archetype || 'Balanced', inline: true },
                        { name: 'Position', value: data.position || 'PG', inline: true }
                    )
                    .setTimestamp();
                break;
            }
            case 'build_switch': {
                embed = new EmbedBuilder()
                    .setColor(0x3B82F6)
                    .setAuthor({ name: data.displayName, iconURL: data.avatar || undefined })
                    .setDescription(`🔄 Switched to build: **${data.buildName}** (${data.overall} OVR)`)
                    .setTimestamp();
                break;
            }
            case 'match_start': {
                embed = new EmbedBuilder()
                    .setColor(0xEF4444)
                    .setDescription(`⚔️ **${data.hostName}** vs **${data.guestName}**`)
                    .addFields(
                        { name: '🏠 Host', value: `${data.hostBuild} (${data.hostOvr} OVR)`, inline: true },
                        { name: '🎮 Guest', value: `${data.guestBuild} (${data.guestOvr} OVR)`, inline: true },
                        { name: '🗺️ Park', value: data.park || 'Blacktop', inline: true }
                    )
                    .setTimestamp();
                break;
            }
            case 'match_end': {
                embed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setDescription(`🏆 **${data.winnerName}** defeated **${data.loserName}**`)
                    .addFields(
                        { name: 'Winner ELO', value: `${data.winnerElo}`, inline: true },
                        { name: 'Loser ELO', value: `${data.loserElo}`, inline: true }
                    )
                    .setTimestamp();
                break;
            }
            case 'purchase': {
                embed = new EmbedBuilder()
                    .setColor(0xF59E0B)
                    .setAuthor({ name: data.displayName, iconURL: data.avatar || undefined })
                    .setDescription(`🪙 Purchased **${data.amount.toLocaleString()} VC**`)
                    .setTimestamp();
                break;
            }
            default:
                return;
        }

        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('[BOT] Failed to log activity:', err.message);
    }
}

// ── Existing Functions ──

async function assignMatchmakingRole(discordUserId) {
    if (!client || !ready) throw new Error('Bot not ready');

    const guild = await client.guilds.fetch(config.discord.guildId);
    if (!guild) throw new Error('Guild not found');

    const member = await guild.members.fetch(discordUserId);
    if (!member) throw new Error('Member not found in guild');

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

        let category = guild.channels.cache.find(c => c.name === 'Disputes' && c.type === ChannelType.GuildCategory);
        if (!category) {
            category = await guild.channels.create({
                name: 'Disputes',
                type: ChannelType.GuildCategory
            });
        }

        const channelName = `dispute-${matchId.split('-')[0]}`;
        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: p1DiscordId,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: p2DiscordId,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: client.user.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                }
            ]
        });

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

module.exports = { initBot, assignMatchmakingRole, createDisputeTicket, logActivity, getClient, isReady };
