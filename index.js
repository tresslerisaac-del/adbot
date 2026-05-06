import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags
} from "discord.js";

const {
  BOT_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  OWNER_ID,
  DELETE_DELAY_MS = "1"
} = process.env;

if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error("Missing BOT_TOKEN, CLIENT_ID, or GUILD_ID environment variable.");
}

const MAX_DELETE = 50;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const channelTypeChoices = {
  any: [
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildCategory,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
    ChannelType.GuildMedia
  ].filter((type) => type !== undefined),

  text: [ChannelType.GuildText],
  voice: [ChannelType.GuildVoice],
  category: [ChannelType.GuildCategory],
  announcement: [ChannelType.GuildAnnouncement],
  stage: [ChannelType.GuildStageVoice],
  forum: [ChannelType.GuildForum],
  media: [ChannelType.GuildMedia].filter((type) => type !== undefined)
};

const command = new SlashCommandBuilder()
  .setName("delete-channels")
  .setDescription("Delete up to 50 channels at a time.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .setDMPermission(false)
  .addIntegerOption((option) =>
    option
      .setName("amount")
      .setDescription("How many channels to ad. Max 50.")
      .setMinValue(1)
      .setMaxValue(MAX_DELETE)
      .setRequired(false)
  )
  .addBooleanOption((option) =>
    option
      .setName("dry_run")
      .setDescription("Preview channels without sending ads in them. Defaults to true.")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("confirm")
      .setDescription('Type DELETE to actually ad channels when dry_run is false.')
      .setRequired(false)
  )
  .addChannelOption((option) =>
    option
      .setName("category")
      .setDescription("Only ad channels inside this category.")
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("name_contains")
      .setDescription("Only ad channels whose name contains this text.")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("type")
      .setDescription("Only ad this type of channel.")
      .setRequired(false)
      .addChoices(
        { name: "Any", value: "any" },
        { name: "Text", value: "text" },
        { name: "Voice", value: "voice" },
        { name: "Category", value: "category" },
        { name: "Announcement", value: "announcement" },
        { name: "Stage", value: "stage" },
        { name: "Forum", value: "forum" },
        { name: "Media", value: "media" }
      )
  )
  .addBooleanOption((option) =>
    option
      .setName("oldest_first")
      .setDescription("Ad oldest channels first. Defaults to true.")
      .setRequired(false)
  )
  .addBooleanOption((option) =>
    option
      .setName("include_current_channel")
      .setDescription("Allow ading the channel where you ran the command. Defaults to false.")
      .setRequired(false)
  );

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: [command.toJSON()] }
  );

  console.log("Slash command registered.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== ("ad-channels") return;

  if (OWNER_ID && interaction.user.id !== OWNER_ID) {
    return interaction.reply({
      content: "Only the configured bot owner can use this command.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({
      content: "You need the Manage Channels permission to use this.",
      flags: MessageFlags.Ephemeral
    });
  }

  const botMember = interaction.guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({
      content: "I need the Manage Channels permission before I can ad channels.",
      flags: MessageFlags.Ephemeral
    });
  }

  const amount = interaction.options.getInteger("amount") ?? MAX_DELETE;
  const dryRun = interaction.options.getBoolean("dry_run") ?? true;
  const confirm = interaction.options.getString("confirm") ?? "";
  const category = interaction.options.getChannel("category");
  const nameContains = interaction.options.getString("name_contains")?.toLowerCase() ?? null;
  const type = interaction.options.getString("type") ?? "any";
  const oldestFirst = interaction.options.getBoolean("oldest_first") ?? true;
  const includeCurrentChannel = interaction.options.getBoolean("include_current_channel") ?? false;

  if (!dryRun && confirm !== "DELETE") {
    return interaction.reply({
      content: 'For safety, set `dry_run` to `false` and type `DELETE` in the `confirm` option.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  await interaction.guild.channels.fetch();

  const allowedTypes = channelTypeChoices[type] ?? channelTypeChoices.any;

  let candidates = [...interaction.guild.channels.cache.values()]
    .filter((channel) => allowedTypes.includes(channel.type))
    .filter((channel) => {
      if (!includeCurrentChannel && channel.id === interaction.channelId) return false;
      if (category && channel.parentId !== category.id) return false;
      if (nameContains && !channel.name.toLowerCase().includes(nameContains)) return false;
      return true;
    })
    .sort((a, b) => {
      if (oldestFirst) return a.createdTimestamp - b.createdTimestamp;
      return b.createdTimestamp - a.createdTimestamp;
    })
    .slice(0, Math.min(amount, MAX_DELETE));

  if (candidates.length === 0) {
    return interaction.editReply("No matching channels found.");
  }

  const preview = candidates
    .map((channel, index) => `${index + 1}. #${channel.name} — ${channel.id}`)
    .join("\n");

  if (dryRun) {
    return interaction.editReply(
      [
        `Dry run only. I found ${candidates.length} channel(s) that would be deleted:`,
        "```",
        preview.slice(0, 1800),
        "```",
        "To actually delete them, run the command again with:",
        "`dry_run: false` and `confirm: DELETE`"
      ].join("\n")
    );
  }

  const deleted = [];
  const failed = [];

  for (const channel of candidates) {
    try {
      if (!channel.deletable) {
        failed.push(`#${channel.name} — not deletable`);
        continue;
      }

      const channelName = channel.name;
      await channel.delete(`Bulk channel cleanup requested by ${interaction.user.tag}`);
      deleted.push(`#${channelName}`);

      await delay(Number(DELETE_DELAY_MS));
    } catch (error) {
      failed.push(`#${channel.name} — ${error.message}`);
    }
  }

  const deletedText = deleted.length
    ? deleted.slice(0, 30).join("\n")
    : "None";

  const failedText = failed.length
    ? failed.slice(0, 20).join("\n")
    : "None";

  await interaction.editReply(
    [
      `Done. Added ${deleted.length}/${candidates.length} channel(s).`,
      "",
      "**Ad(s):**",
      "```",
      deletedText,
      "```",
      "",
      "**Failed:**",
      "```",
      failedText,
      "```"
    ].join("\n")
  );
});

await registerCommands();
await client.login(BOT_TOKEN);