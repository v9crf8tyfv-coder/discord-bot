const { Client, GatewayIntentBits, SlashCommandBuilder, Routes, REST } = require('discord.js');
const cron = require('node-cron');
const sqlite3 = require("sqlite3").verbose();

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// DB
const db = new sqlite3.Database("./alerts.db");

db.run(`
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT,
    userId TEXT,
    channelId TEXT,
    time TEXT,
    message TEXT,
    image TEXT
)
`);

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
        .setDescription('Stop TON alerte uniquement')
].map(cmd => cmd.toJSON());

// REGISTER COMMANDS
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
    );
    console.log("Commandes installées");
})();

// READY
client.once('ready', () => {
    console.log(`BOT CONNECTÉ : ${client.user.tag}`);

    db.all("SELECT * FROM alerts", (err, rows) => {
        if (err) return console.log(err);
        rows.forEach(alert => startCron(alert));
    });
});

// CRON
function startCron(alert) {
    if (!tasks[alert.guildId]) tasks[alert.guildId] = {};

    if (!tasks[alert.guildId][alert.userId]) {
        tasks[alert.guildId][alert.userId] = {};
    }

    const [h, m] = alert.time.split(':');

    let count = 1;

    const task = cron.schedule(`${m} ${h} * * *`, async () => {
        try {
            const channel = await client.channels.fetch(alert.channelId);

            let msg = alert.message
                .replace("{count}", count)
                .replace("{user}", `<@${alert.userId}>`);

            await channel.send(msg);

            if (alert.image) await channel.send(alert.image);

            count++;
        } catch (err) {
            console.log("CRON ERROR:", err);
        }
    }, {
        timezone: "Europe/Brussels"
    });

    tasks[alert.guildId][alert.userId][alert.id] = task;
}

// INTERACTIONS
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guild.id;

    try {

        // CREATE
        if (interaction.commandName === 'alertepingday') {

            await interaction.deferReply();

            const user = interaction.options.getUser('utilisateur');
            const time = interaction.options.getString('time');
            const message = interaction.options.getString('message');
            const image = interaction.options.getString('image');

            db.run(
                "INSERT INTO alerts (guildId, userId, channelId, time, message, image) VALUES (?, ?, ?, ?, ?, ?)",
                [guildId, user.id, interaction.channel.id, time, message, image],
                function (err) {
                    if (err) return console.log(err);

                    startCron({
                        id: this.lastID,
                        guildId,
                        userId: user.id,
                        channelId: interaction.channel.id,
                        time,
                        message,
                        image
                    });
                }
            );

            return interaction.editReply(`✅ Alerte créée pour ${user.username}`);
        }

        // STOP (SECURE)
        if (interaction.commandName === 'stopalertepingday') {

            await interaction.deferReply();

            const userId = interaction.user.id;

            db.get(
                "SELECT * FROM alerts WHERE guildId = ? AND userId = ?",
                [guildId, userId],
                (err, alert) => {
                    if (err) return console.log(err);

                    if (!alert) {
                        return interaction.editReply("❌ Tu n'as aucune alerte");
                    }

                    if (tasks[guildId]?.[userId]?.[alert.id]) {
                        tasks[guildId][userId][alert.id].stop();
                        delete tasks[guildId][userId][alert.id];
                    }

                    db.run(
                        "DELETE FROM alerts WHERE id = ?",
                        [alert.id]
                    );

                    return interaction.editReply("🛑 Ton alerte a été supprimée");
                }
            );
        }

    } catch (err) {
        console.log(err);
        if (!interaction.replied) {
            await interaction.reply("❌ Erreur");
        }
    }
});

client.login(TOKEN);