import { config } from './config/env.js';
import { logger } from './infrastructure/logging/logger.js';
import { startDiscordClient } from './infrastructure/discord/client.js';

/**
 * Punto de entrada (seccion 18, primer entregable):
 * bot privado que responde `/help` y `/status`, rechaza usuarios no
 * autorizados y registra eventos relevantes sin exponer secretos.
 */
async function main(): Promise<void> {
  logger.info(
    {
      event: 'boot',
      guildId: config.guildId ?? 'global',
      allowedUsers: config.allowedUserIds.length,
    },
    'arrancando DevBot (Discord adapter)',
  );

  await startDiscordClient();
}

main().catch((error) => {
  logger.fatal({ err: error }, 'fallo fatal al arrancar');
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ event: 'shutdown', signal }, 'apagando DevBot');
    process.exit(0);
  });
}
