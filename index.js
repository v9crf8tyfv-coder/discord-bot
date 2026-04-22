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

// COMMANDS
const commands = [
    new SlashCommandBuilder()
        .setName('alertepingday')
        .setDescription('Créer une alerte quotidienne')
        .addStringOption(option =>
            option.setName('time').setDescription('HH:MM').setRequired(true))
        .addStringOption(option =>
            option.setName('message').setDescription('Message').setRequired(true))
        .addStringOption(option =>
            option.setName('image').setDescription('Image (optionnel)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('stopalertepingday')
        .setDescription('Supprimer UNE de tes alertes')
        .addIntegerOption(option =>
            option.setName('id').setDescription('ID de ton alerte').setRequired(true))
].map(cmd => cmd.toJSON());

// REGISTER
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
        rows.forEach(startCron);
    });
});

// CRON
function startCron(alert) {
    if (!tasks[alert.id]) {

        let count = 1;
        const [h, m] = alert.time.split(':');

        const task = cron.schedule(`${m} ${h} * * *`, async () => {
            try {
                const channel = await client.channels.fetch(alert.channelId);
                if (!channel) return;

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

        tasks[alert.id] = task;
    }
}

// INTERACTIONS
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) {
        return interaction.reply({
            content: "❌ Commande utilisable uniquement sur un serveur",
            ephemeral: true
        });
    }

    const guildId = interaction.guild.id;

    try {

        // CREATE ALERT
        if (interaction.commandName === 'alertepingday') {

            await interaction.deferReply({ ephemeral: true });

            const time = interaction.options.getString('time');
            const message = interaction.options.getString('message');
            const image = interaction.options.getString('image');
            const userId = interaction.user.id;

            db.run(
                "INSERT INTO alerts (guildId, userId, channelId, time, message, image) VALUES (?, ?, ?, ?, ?, ?)",
                [guildId, userId, interaction.channel.id, time, message, image],
                function (err) {
                    if (err) return console.log(err);

                    startCron({
                        id: this.lastID,
                        guildId,
                        userId,
                        channelId: interaction.channel.id,
                        time,
                        message,
                        image
                    });

                    setTimeout(() => {
                        interaction.editReply(`✅ Alerte créée ! ID = **${this.lastID}**`);
                    }, 100);
                }
            );
        }

        // DELETE SAFE (OWNER ONLY)
        if (interaction.commandName === 'stopalertepingday') {

            await interaction.deferReply({ ephemeral: true });

            const id = interaction.options.getInteger('id');
            const userId = interaction.user.id;

            db.get(
                "SELECT * FROM alerts WHERE id = ?",
                [id],
                (err, alert) => {
                    if (err) return console.log(err);

                    if (!alert) {
                        return interaction.editReply("❌ Aucune alerte trouvée");
                    }

                    if (alert.userId !== userId) {
                        return interaction.editReply("❌ Tu ne peux supprimer QUE tes alertes");
                    }

                    if (tasks[id]) {
                        tasks[id].stop();
                        delete tasks[id];
                    }

                    db.run("DELETE FROM alerts WHERE id = ?", [id]);

                    return interaction.editReply(`🛑 Alerte ${id} supprimée`);
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