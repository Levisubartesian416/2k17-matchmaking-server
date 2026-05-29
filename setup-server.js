require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once('ready', async () => {
    console.log(`[+] Logged in as ${client.user.tag}`);

    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
        console.error('[-] Error: DISCORD_GUILD_ID is not set in your .env file.');
        process.exit(1);
    }

    try {
        const guild = await client.guilds.fetch(guildId);
        console.log(`[+] Found server: ${guild.name}`);

        console.log('[*] Setting up roles...');

        // 1. Set @everyone to NOT be able to view channels by default
        await guild.roles.everyone.setPermissions([
            PermissionsBitField.Flags.ReadMessageHistory
        ]);
        console.log('    -> Removed default view permissions from @everyone');

        // 2. Create Roles
        const roles = {};
        
        roles.admin = await getOrCreateRole(guild, 'Admin', {
            color: '#ff0000',
            permissions: [PermissionsBitField.Flags.Administrator],
            hoist: true
        });

        roles.mod = await getOrCreateRole(guild, 'Moderator', {
            color: '#ffaa00',
            permissions: [
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.KickMembers,
                PermissionsBitField.Flags.BanMembers,
                PermissionsBitField.Flags.MuteMembers,
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages
            ],
            hoist: true
        });

        // This is the role the app gives when they link Discord
        roles.matchmaking = await getOrCreateRole(guild, 'Matchmaking', {
            color: '#a855f7',
            permissions: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak
            ],
            hoist: true
        });

        console.log('[*] Setting up channels...');

        // --- INFORMATION CATEGORY (Visible to everyone) ---
        const infoCat = await getOrCreateCategory(guild, '📌 INFORMATION');
        
        await getOrCreateChannel(guild, 'welcome-and-verify', ChannelType.GuildText, infoCat, [
            { id: guild.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: [PermissionsBitField.Flags.SendMessages] }
        ], 'Welcome! Open the 2K17 Revival App and connect your Discord to get verified and access the rest of the server.');

        await getOrCreateChannel(guild, 'rules', ChannelType.GuildText, infoCat, [
            { id: guild.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] },
            { id: roles.admin.id, allow: [PermissionsBitField.Flags.SendMessages] }
        ]);

        await getOrCreateChannel(guild, 'announcements', ChannelType.GuildText, infoCat, [
            { id: guild.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] },
            { id: roles.admin.id, allow: [PermissionsBitField.Flags.SendMessages] }
        ]);


        // --- COMMUNITY CATEGORY (Only visible to verified Matchmaking role) ---
        const communityCat = await getOrCreateCategory(guild, '💬 COMMUNITY', [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: roles.matchmaking.id, allow: [PermissionsBitField.Flags.ViewChannel] }
        ]);

        await getOrCreateChannel(guild, 'general-chat', ChannelType.GuildText, communityCat);
        await getOrCreateChannel(guild, 'looking-for-game', ChannelType.GuildText, communityCat);
        await getOrCreateChannel(guild, 'highlights', ChannelType.GuildText, communityCat);


        // --- VOICE CATEGORY (Only visible to verified Matchmaking role) ---
        const voiceCat = await getOrCreateCategory(guild, '🔊 VOICE CHANNELS', [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: roles.matchmaking.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect] }
        ]);

        await getOrCreateChannel(guild, 'General Lounge', ChannelType.GuildVoice, voiceCat);
        await getOrCreateChannel(guild, '1v1 Room 1', ChannelType.GuildVoice, voiceCat, [], null, 2); // Limit 2 users
        await getOrCreateChannel(guild, '1v1 Room 2', ChannelType.GuildVoice, voiceCat, [], null, 2);

        console.log('');
        console.log('[+] SERVER SETUP COMPLETE! 🚀');
        console.log('[!] NOTE: Make sure your bot role ("2K17 Revival") is dragged to the VERY TOP of the roles list in Server Settings -> Roles, so it has permission to assign the other roles.');
        process.exit(0);

    } catch (error) {
        console.error('[-] Error setting up server:', error);
        process.exit(1);
    }
});

// Helper functions to prevent creating duplicates if run multiple times
async function getOrCreateRole(guild, name, options) {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) {
        role = await guild.roles.create({ name, ...options });
        console.log(`    -> Created role: ${name}`);
    } else {
        console.log(`    -> Role already exists: ${name}`);
    }
    return role;
}

async function getOrCreateCategory(guild, name, permissionOverwrites = []) {
    let category = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
    if (!category) {
        category = await guild.channels.create({
            name,
            type: ChannelType.GuildCategory,
            permissionOverwrites
        });
        console.log(`    -> Created category: ${name}`);
    } else {
        // Update permissions just in case
        if (permissionOverwrites.length > 0) {
            await category.permissionOverwrites.set(permissionOverwrites);
        }
    }
    return category;
}

async function getOrCreateChannel(guild, name, type, parentCategory, permissionOverwrites = [], topic = null, userLimit = 0) {
    let channel = guild.channels.cache.find(c => c.name === name && c.type === type && c.parentId === parentCategory.id);
    if (!channel) {
        const options = { name, type, parent: parentCategory.id };
        if (permissionOverwrites.length > 0) options.permissionOverwrites = permissionOverwrites;
        if (topic) options.topic = topic;
        if (userLimit > 0) options.userLimit = userLimit;

        channel = await guild.channels.create(options);
        
        // If we set a topic, send it as a message to initialize it
        if (topic && type === ChannelType.GuildText) {
            await channel.send(`**${topic}**`);
        }
        
        console.log(`        -> Created channel: ${name}`);
    }
    return channel;
}

client.login(process.env.DISCORD_BOT_TOKEN);
