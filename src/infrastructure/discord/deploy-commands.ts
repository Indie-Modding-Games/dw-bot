import { config } from '../../config/env.js';
import { logger } from '../logging/logger.js';
import { deploySlashCommands } from './deployer.js';

/**
 * Script de despliegue manual: `npm run deploy:commands`.
 * Con DEVBOT_GUILD_ID definido registra comandos de servidor; sin el,
 * registra globalmente (recomendado para produccion, propagacion lenta).
 */
async function main(): Promise<void> {
  await deploySlashCommands({
    token: config.discordToken,
    applicationId: config.applicationId,
    guildId: config.guildId,
    logger,
  });
  logger.info('despliegue de comandos completado');
  // Los sockets keep-alive de undici mantendrian vivo el proceso: salir explicito.
  process.exit(0);
}

main().catch((error) => {
  logger.fatal({ err: error }, 'despliegue de comandos fallo');
  process.exit(1);
});
