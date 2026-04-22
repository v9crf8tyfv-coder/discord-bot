const { Client, GatewayIntentBits, SlashCommandBuilder, Routes, REST } = require('discord.js');
const cron = require('node-cron');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

let tasks = {};

// COMMANDES
const commands = [
    new SlashCommandBuilder()
        .setName('alertepingday')
        .setDescription('Créer une alerte quotidienne')
        .addUserOption(option =>
            option.setName('utilisateur').setDescription('Utilisateur').setRequired(true))
        .addStringOption(option =>
            option.setName('time').setDescription('HH:MM').setRequired(true))
        .addStringOption(option =>
            option.setName('message').setDescription('Message').setRequired(true))
        .addStringOption(option =>
            option.setName('image').setDescription('Image (optionnel)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('stopalertepingday')
        .setDescription('Stop une alerte')
        .addUserOption(option =>
            option.setName('utilisateur').setDescription('Utilisateur').setRequired(true))
].map(cmd => cmd.toJSON());

// ENREGISTREMENT COMMANDES
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
    );
    console.log("Commandes installées");
})();

// EVENTS
client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isChatInputCommand()) return;

        const guildId = interaction.guild.id;
        if (!tasks[guildId]) tasks[guildId] = {};

        // CREATE ALERT
        if (interaction.commandName === 'alertepingday') {
            await interaction.reply("⏳ Création de l’alerte...");

            const user = interaction.options.getUser('utilisateur');
            const time = interaction.options.getString('time');
            const message = interaction.options.getString('message');
            const image = interaction.options.getString('image');

            const [h, m] = time.split(':').map(Number);
            const channelId = interaction.channel.id;

            let count = 1;

            const task = cron.schedule(`${m} ${h} * * *`, async () => {
                console.log("CRON TRIGGER");

                const channel = await client.channels.fetch(channelId);

                let msg = message
                    .replace("{user}", `<@${user.id}>`)
                    .replace("{count}", count);

                await channel.send(msg);
                if (image) await channel.send(image);

                count++;
            }, {
                timezone: "Europe/Brussels"
            });

            tasks[guildId][user.id] = task;

            return interaction.followUp(`✅ Alerte créée pour ${user.username}`);
        }

        // STOP ALERT
        if (interaction.commandName === 'stopalertepingday') {
            await interaction.reply("🛑 Arrêt en cours...");

            const user = interaction.options.getUser('utilisateur');

            if (tasks[guildId][user.id]) {
                tasks[guildId][user.id].stop();
                delete tasks[guildId][user.id];

                return interaction.followUp(`✅ Alerte stoppée pour ${user.username}`);
            }

            return interaction.followUp("❌ Aucune alerte trouvée");
        }

    } catch (err) {
        console.log("ERROR:", err);

        if (!interaction.replied) {
            await interaction.reply("❌ Erreur dans la commande");
        }
    }
});

// READY
client.on('ready', () => {
    console.log(`BOT CONNECTÉ : ${client.user.tag}`);
});

client.login(TOKEN);