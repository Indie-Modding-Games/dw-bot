import { REST, Routes } from 'discord.js';
import type { Logger } from 'pino';
import { slashCommandsJson } from './slash-commands.js';

export interface DeployOptions {
  token: string;
  applicationId: string;
  /** Con guildId se registran comandos de servidor (propagacion inmediata). */
  guildId?: string;
  logger: Logger;
}

/**
 * Registra los slash commands via la API REST de Discord.
 * PUT es idempotente: se puede ejecutar en cada arranque.
 */
export async function deploySlashCommands(options: DeployOptions): Promise<void> {
  const { token, applicationId, guildId, logger } = options;
  const rest = new REST({ version: '10' }).setToken(token);

  const route = guildId
    ? Routes.applicationGuildCommands(applicationId, guildId)
    : Routes.applicationCommands(applicationId);

  const scope = guildId ? `guild ${guildId}` : 'global';
  try {
    const data = await rest.put(route, { body: slashCommandsJson });
    const count = Array.isArray(data) ? data.length : 0;
    logger.info({ scope, registered: count }, 'slash commands registrados');
  } catch (error) {
    logger.error({ err: error, scope }, 'fallo al registrar slash commands');
    throw error;
  }
}
