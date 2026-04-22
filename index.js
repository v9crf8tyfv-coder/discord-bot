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

// CREATE TABLE
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
        .setDescription('Stop une alerte')
        .addUserOption(option =>
            option.setName('utilisateur').setDescription('Utilisateur').setRequired(true))
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

// RESTORE ALERTS ON START
client.once('ready', () => {
    console.log(`BOT CONNECTÉ : ${client.user.tag}`);

    db.all("SELECT * FROM alerts", (err, rows) => {
        if (err) return console.log(err);

        rows.forEach(alert => {
            startCron(alert);
        });
    });
});

// FUNCTION CRON
function startCron(alert) {
    const [h, m] = alert.time.split(':');

    if (!tasks[alert.guildId]) tasks[alert.guildId] = {};

    let count = 1;

    const task = cron.schedule(`${m} ${h} * * *`, async () => {
        const channel = await client.channels.fetch(alert.channelId);

        let msg = alert.message
            .replace("{count}", count)
            .replace("{user}", `<@${alert.userId}>`);

        await channel.send(msg);

        if (alert.image) {
            await channel.send(alert.image);
        }

        count++;
    }, {
        timezone: "Europe/Brussels"
    });

    tasks[alert.guildId][alert.userId] = task;
}

// EVENTS
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guild.id;

    // CREATE ALERT
    if (interaction.commandName === 'alertepingday') {

        const user = interaction.options.getUser('utilisateur');
        const time = interaction.options.getString('time');
        const message = interaction.options.getString('message');
        const image = interaction.options.getString('image');

        // SAVE DB
        db.run(
            "INSERT INTO alerts (guildId, userId, channelId, time, message, image) VALUES (?, ?, ?, ?, ?, ?)",
            [guildId, user.id, interaction.channel.id, time, message, image]
        );

        const fakeAlert = {
            guildId,
            userId: user.id,
            channelId: interaction.channel.id,
            time,
            message,
            image
        };

        startCron(fakeAlert);

        return interaction.reply(`✅ Alerte créée pour ${user.username}`);
    }

    // STOP ALERT
    if (interaction.commandName === 'stopalertepingday') {

        const user = interaction.options.getUser('utilisateur');

        if (tasks[guildId]?.[user.id]) {
            tasks[guildId][user.id].stop();
            delete tasks[guildId][user.id];
        }

        db.run(
            "DELETE FROM alerts WHERE guildId = ? AND userId = ?",
            [guildId, user.id]
        );

        return interaction.reply(`🛑 Alerte supprimée pour ${user.username}`);
    }
});

client.login(TOKEN);