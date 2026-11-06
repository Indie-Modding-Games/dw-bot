import { once } from 'node:events';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from '../../config/env.js';
import type { FeedbackService } from '../../application/services/feedback.service.js';
import { logger } from '../logging/logger.js';
import { deploySlashCommands } from './deployer.js';
import { routeInteraction } from './interactions.js';

export interface DiscordClientDependencies {
  /**
   * Acceso perezoso al servicio de feedback: se construye despues del login
   * porque necesita el cliente autenticado para escribir en el canal.
   */
  getFeedback: () => FeedbackService | null;
}

/**
 * Arranca el cliente de Discord y espera a que este listo.
 * Unicos intents: Guilds (suficiente para slash commands, minimo privilegio
 * segun seccion 11, punto 11).
 */
export async function startDiscordClient(deps: DiscordClientDependencies): Promise<Client<true>> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info(
      { event: 'client.ready', username: readyClient.user.username },
      'bot conectado a Discord',
    );

    try {
      // Con DEVBOT_GUILD_ID definido se registran comandos de servidor:
      // propagacion inmediata, ideal para el servidor de pruebas privado.
      // Para registro global usar `npm run deploy:commands` sin guild id.
      await deploySlashCommands({
        token: config.discordToken,
        applicationId: config.applicationId,
        guildId: config.guildId,
        logger,
      });
    } catch {
      // El registro de comandos fallo; dejar log claro y seguir conectados.
      logger.error('los slash commands no se registraron; revisa token/IDs en .env');
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    await routeInteraction(interaction, {
      authorization: {
        allowedUserIds: config.allowedUserIds,
        allowedGuildIds: config.allowedGuildIds,
      },
      logger,
      getBotStatus: () => ({
        uptimeMs: client.uptime ?? 0,
        webSocketPingMs: Math.round(client.ws.ping),
        guildCount: client.guilds.cache.size,
        readyAt: client.readyTimestamp ? new Date(client.readyTimestamp) : null,
      }),
      getFeedback: deps.getFeedback,
    });
  });

  client.on(Events.Error, (error) => {
    logger.error({ err: error }, 'error del cliente de Discord');
  });

  client.on(Events.ShardDisconnect, (_previousClose, shardId) => {
    logger.warn({ event: 'client.shard_disconnected', shardId }, 'shard desconectado');
  });

  client.on(Events.ShardResume, (shardId, sessionLengthSeconds) => {
    logger.info(
      { event: 'client.shard_resume', shardId, sessionLengthSeconds },
      'shard reconectado',
    );
  });

  // Parar en seco si el login falla: sin conexion el bot no sirve para nada.
  await client.login(config.discordToken);
  if (!client.isReady()) {
    await once(client, Events.ClientReady);
  }
  // Una vez emitido ClientReady, discord.js garantiza el estado listo.
  return client as unknown as Client<true>;
}
