import { pino } from 'pino';
import { config } from '../../config/env.js';

/**
 * Logger estructurado con Pino (seccion 6).
 * Regla de seguridad: nunca registrar tokens ni secretos. Los unicos
 * campos por defecto son de nivel operativo.
 */
const transport = config.prettyLogs
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
  : undefined;

export const logger = pino({
  level: config.logLevel,
  base: { service: 'devbot' },
  transport,
});
