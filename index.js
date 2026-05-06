import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} from "discord.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = process.env.OWNER_ID;

if (!BOT_TOKEN) throw new Error("Missing BOT_TOKEN in Railway variables.");
if (!CLIENT_ID) throw new Error("Missing CLIENT_ID in Railway variables.");
if (!GUILD_ID) throw new Error("Missing GUILD_ID in Railway variables.");

const MAX_ADS = 50;
const ADS_DELAY_MS = 1200;

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const allowedChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildMedia
].filter(type => type !== undefined);

const command = new SlashCommandBuilder()
  .setName("ads")
  .setDescription("Ad processing for up to 50 channels at a time.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .setDMPermission(false)
  .addIntegerOption(option =>
    option
      .setName("ads_count")
      .setDescription("How many channels to process. Max 50.")
      .setMinValue(1)
      .setMaxValue(MAX_ADS)
      .setRequired(false)
  )
  .addBooleanOption(option =>
    option
      .setName("preview")
      .setDescription("Preview only. Defaults to true.")
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName("confirm")
      .setDescription("Type ADS to confirm Ad processing.")
      .setRequired(false)
  )
  .addChannelOption(option =>
    option
      .setName("category")
      .setDescription("Only process channels inside this category.")
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName("name_contains")
      .setDescription("Only process channels whose names contain this text.")
      .setRequired(false)
  );

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    {
      body: [command.toJSON()]
    }
  );

  console.log("Ad processing command registered.");
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "ads") return;

  if (OWNER_ID && interaction.user.id !== OWNER_ID) {
    return interaction.reply({
      content: "Only the configured owner can use Ad processing.",
      ephemeral: true
    });
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({
      content: "You need Manage Channels permission to use Ad processing.",
      ephemeral: true
    });
  }

  const botMember = interaction.guild.members.me;

  if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({
      content: "I need Manage Channels permission before Ad processing can run.",
      ephemeral: true
    });
  }

  const adsCount = interaction.options.getInteger("ads_count") ?? MAX_ADS;
  const preview = interaction.options.getBoolean("preview") ?? true;
  const confirm = interaction.options.getString("confirm") ?? "";
  const category = interaction.options.getChannel("category");
  const nameContains = interaction.options.getString("name_contains")?.toLowerCase();

  if (!preview && confirm !== "ADS") {
    return interaction.reply({
      content: "Safety check failed. Use `preview:false` and `confirm:ADS`.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  await interaction.guild.channels.fetch();

  const channels = [...interaction.guild.channels.cache.values()]
    .filter(channel => channel.id !== interaction.channelId)
    .filter(channel => allowedChannelTypes.includes(channel.type))
    .filter(channel => {
      if (category && channel.parentId !== category.id) return false;
      if (nameContains && !channel.name.toLowerCase().includes(nameContains)) return false;
      return true;
    })
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .slice(0, Math.min(adsCount, MAX_ADS));

  if (channels.length === 0) {
    return interaction.editReply("No matching channels found for Ad processing.");
  }

  const adsList = channels
    .map((channel, index) => `${index + 1}. #${channel.name}`)
    .join("\n");

  if (preview) {
    return interaction.editReply(
      [
        `Ad processing preview only. These ${channels.length} channel(s) would be processed and removed:`,
        "",
        "```",
        adsList,
        "```",
        "",
        "To run Ad processing, use:",
        "`preview:false` and `confirm:ADS`"
      ].join("\n")
    );
  }

  let completed = 0;
  let failed = 0;

  for (const channel of channels) {
    try {
      await channel.delete(`Ad processing requested by ${interaction.user.tag}`);
      completed++;

      await new Promise(resolve => setTimeout(resolve, ADS_DELAY_MS));
    } catch (error) {
      console.error(`Ad processing failed for ${channel.name}:`, error);
      failed++;
    }
  }

  return interaction.editReply(
    `Ad processing finished. Channels removed: ${completed}. Failed: ${failed}.`
  );
});

try {
  await registerCommands();
  await client.login(BOT_TOKEN);
} catch (error) {
  console.error("Startup failed:", error);
  process.exit(1);
}
