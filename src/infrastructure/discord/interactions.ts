import type { ChatInputCommandInteraction } from 'discord.js';
import type { Logger } from 'pino';
import { canInteract, type AuthorizationConfig } from '../../application/authorization.js';
import { handleHelp } from '../../application/handlers/help.js';
import { handleStatus } from '../../application/handlers/status.js';
import type { BotStatus, CommandContext } from '../../application/handlers/types.js';

export interface RouterDependencies {
  authorization: AuthorizationConfig;
  logger: Logger;
  /** El adaptador extrae el estado del cliente y lo pasa al caso de uso. */
  getBotStatus: () => BotStatus;
}

function toContext(interaction: ChatInputCommandInteraction): CommandContext {
  return {
    userId: interaction.user.id,
    userName: interaction.user.username,
    reply: async (content, options = {}) => {
      const payload = { content, ephemeral: options.ephemeral ?? false };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    },
  };
}

/**
 * Enruta una interaccion de slash command hacia los casos de uso,
 * aplicando la allowlist antes de ejecutar nada (seccion 11, punto 1).
 */
export async function routeInteraction(
  interaction: ChatInputCommandInteraction,
  deps: RouterDependencies,
): Promise<void> {
  const { authorization, logger } = deps;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (!canInteract(authorization, userId, guildId)) {
    logger.warn(
      { event: 'interaction.denied', userId, guildId, command: interaction.commandName },
      'interaccion rechazada por allowlist',
    );
    await interaction
      .reply({ content: 'No tienes permiso para usar este bot.', ephemeral: true })
      .catch(() => undefined);
    return;
  }

  logger.info(
    { event: 'interaction.received', userId, guildId, command: interaction.commandName },
    'slash command invocado',
  );

  const ctx = toContext(interaction);

  try {
    switch (interaction.commandName) {
      case 'help':
        await handleHelp(ctx);
        break;
      case 'status':
        await handleStatus(ctx, deps.getBotStatus());
        break;
      default:
        await ctx.reply('Comando no reconocido.', { ephemeral: true });
    }
  } catch (error) {
    logger.error({ err: error, command: interaction.commandName }, 'error al manejar comando');
    await ctx
      .reply('Ocurrio un error al procesar el comando.', { ephemeral: true })
      .catch(() => undefined);
  }
}
