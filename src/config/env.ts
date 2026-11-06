import 'dotenv/config';
import { z } from 'zod';

/**
 * Validacion de configuracion con Zod (seccion 6 del documento de arquitectura).
 * La aplicacion debe fallar al arrancar si la configuracion es invalida,
 * nunca funcionar con valores parciales.
 */

const csvIds = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
  .refine(
    (list) => list.every((id) => /^\d{1,20}$/.test(id)),
    'Los IDs deben ser cadenas numericas (snowflakes de Discord) separadas por comas',
  );

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN es obligatorio'),
  DISCORD_APPLICATION_ID: z
    .string()
    .regex(/^\d{1,20}$/, 'DISCORD_APPLICATION_ID debe ser un snowflake numerico'),
  DEVBOT_GUILD_ID: z
    .string()
    .regex(/^\d{1,20}$/, 'DEVBOT_GUILD_ID debe ser un snowflake numerico')
    .optional()
    .or(z.literal(''))
    .transform((value) => (value === '' ? undefined : value)),
  // Fail-closed: sin allowlist de usuarios, nadie puede usar el bot.
  DEVBOT_ALLOWED_USER_IDS: csvIds.refine(
    (list) => list.length >= 1,
    'DEVBOT_ALLOWED_USER_IDS debe contener al menos un usuario autorizado',
  ),
  DEVBOT_ALLOWED_GUILD_IDS: z
    .preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? [] : value),
      z.union([csvIds, z.array(z.string()).default([])]),
    )
    .default([]),
  DEVBOT_NOTIFICATION_CHANNEL_ID: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional()
    .or(z.literal(''))
    .transform((value) => (value === '' ? undefined : value)),
  DEVBOT_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DEVBOT_PRETTY_LOGS: z
    .string()
    .optional()
    .transform((value) => value === '1'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => ` - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // No usar el logger aqui: depende de la configuracion que fallo.
  console.error(`Configuracion de entorno invalida en .env:\n${issues}`);
  process.exit(1);
}

export interface AppConfig {
  discordToken: string;
  applicationId: string;
  guildId?: string;
  allowedUserIds: string[];
  allowedGuildIds: string[];
  notificationChannelId?: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  prettyLogs: boolean;
}

export const config: AppConfig = {
  discordToken: parsed.data.DISCORD_TOKEN,
  applicationId: parsed.data.DISCORD_APPLICATION_ID,
  guildId: parsed.data.DEVBOT_GUILD_ID,
  allowedUserIds: parsed.data.DEVBOT_ALLOWED_USER_IDS,
  allowedGuildIds: parsed.data.DEVBOT_ALLOWED_GUILD_IDS,
  notificationChannelId: parsed.data.DEVBOT_NOTIFICATION_CHANNEL_ID,
  logLevel: parsed.data.DEVBOT_LOG_LEVEL,
  prettyLogs: parsed.data.DEVBOT_PRETTY_LOGS,
};
