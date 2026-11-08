import 'dotenv/config';
import { z } from 'zod';
import type { PostSyncPlan } from '../core/feedback/types.js';

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

/** Convierte string vacio de .env en undefined y aplica el schema opcional. */
function optionalValue<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );
}

const snowflake = z.string().regex(/^\d{1,20}$/, 'debe ser un snowflake numerico');

const labelCsv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )
    .refine(
      (list) => list.every((label) => /^[\w][\w./-]{0,49}$/.test(label)),
      'Las etiquetas de GitHub deben ser alfanumericas (separadas por comas)',
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

  // --- Modulo de feedback GitHub/Discord ---
  // Credenciales opcionales: si falta alguna, el modulo queda deshabilitado
  // con un aviso claro (los comandos /bug y /suggest responden que no esta
  // configurado) y el resto del bot sigue funcionando.
  DEVBOT_GITHUB_TOKEN: optionalValue(z.string().min(1)),
  DEVBOT_GITHUB_REPO: optionalValue(
    z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'DEVBOT_GITHUB_REPO debe tener formato owner/repo'),
  ),
  /** ID de GraphQL del proyecto GitHub (Projects v2) para asignar issues. Opcional. */
  DEVBOT_GITHUB_PROJECT_ID: optionalValue(z.string().min(1)),
  DEVBOT_FEEDBACK_CHANNEL_ID: optionalValue(snowflake),
  DEVBOT_FEEDBACK_CRON: z.string().min(1).default('*/5 * * * *'),
  DEVBOT_BUG_LABELS: labelCsv('bug'),
  DEVBOT_SUGGESTION_LABELS: labelCsv('enhancement'),
  DEVBOT_DATA_DIR: optionalValue(z.string().min(1)),

  // --- Ingestion desde foros de Discord (propuestas y bugs) ---
  DEVBOT_FEEDBACK_PROPOSALS_CHANNEL_ID: optionalValue(snowflake),
  DEVBOT_FEEDBACK_BUGS_CHANNEL_ID: optionalValue(snowflake),
  DEVBOT_PROPOSALS_REQUIRED_TAG: z.string().trim().min(1).default('Aceptado'),
  DEVBOT_PROPOSALS_DONE_TAG: z.string().trim().min(1).default('Hecho'),
  DEVBOT_BUGS_REQUIRED_TAG: z.string().trim().min(1).default('En revisión'),
  // Si se define, los posts de bugs tambien cambian de etiqueta cuando su
  // ticket llega a done (p.ej. "✅ Arreglado"). Vacio = no cambiar etiquetas.
  DEVBOT_BUGS_DONE_TAG: optionalValue(z.string().trim().min(1)),
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
  /** Definida solo cuando hay config completa de GitHub/Discord backlog. */
  feedback?: FeedbackConfig;
  /** Variables que faltan cuando la config de feedback esta parcial. */
  feedbackMissing: string[];
}

export interface FeedbackConfig {
  githubToken: string;
  /** owner/repo del backlog de GitHub. */
  repo: string;
  /** Canal de Discord donde se publican y actualizan las fichas. */
  backlogChannelId: string;
  bugLabels: string[];
  suggestionLabels: string[];
  syncCron: string;
  dataDir: string;
  /** Planes de ingestion desde foros (vacio si no hay canales configurados). */
  forumPlans: PostSyncPlan[];
  /** ID de GraphQL del proyecto GitHub (Projects v2) donde asignar issues. */
  projectId?: string;
}

function buildFeedbackConfig(data: z.infer<typeof envSchema>): {
  feedback?: FeedbackConfig;
  feedbackMissing: string[];
} {
  const token = data.DEVBOT_GITHUB_TOKEN;
  const repo = data.DEVBOT_GITHUB_REPO;
  const channelId = data.DEVBOT_FEEDBACK_CHANNEL_ID;

  // Config completa -> modulo activo.
  if (token && repo && channelId) {
    const forumPlans: PostSyncPlan[] = [];
    const proposalsChannel = data.DEVBOT_FEEDBACK_PROPOSALS_CHANNEL_ID;
    const bugsChannel = data.DEVBOT_FEEDBACK_BUGS_CHANNEL_ID;
    if (proposalsChannel) {
      forumPlans.push({
        kind: 'suggestion',
        channelId: proposalsChannel,
        requiredTag: data.DEVBOT_PROPOSALS_REQUIRED_TAG,
        // Unicas que cambian de tag automaticamente al llegar a done.
        doneTag: data.DEVBOT_PROPOSALS_DONE_TAG,
      });
    }
    if (bugsChannel) {
      forumPlans.push({
        kind: 'bug',
        channelId: bugsChannel,
        requiredTag: data.DEVBOT_BUGS_REQUIRED_TAG,
        doneTag: data.DEVBOT_BUGS_DONE_TAG ?? null,
      });
    }

    return {
      feedback: {
        githubToken: token,
        repo,
        backlogChannelId: channelId,
        bugLabels: data.DEVBOT_BUG_LABELS,
        suggestionLabels: data.DEVBOT_SUGGESTION_LABELS,
        syncCron: data.DEVBOT_FEEDBACK_CRON,
        dataDir: data.DEVBOT_DATA_DIR ?? 'data',
        forumPlans,
        projectId: data.DEVBOT_GITHUB_PROJECT_ID,
      },
      feedbackMissing: [],
    };
  }

  const required: Array<{ name: string; value: string | undefined }> = [
    { name: 'DEVBOT_GITHUB_TOKEN', value: token },
    { name: 'DEVBOT_GITHUB_REPO', value: repo },
    { name: 'DEVBOT_FEEDBACK_CHANNEL_ID', value: channelId },
  ];
  const missing = required.filter((entry) => !entry.value).map((entry) => entry.name);

  // Parcial -> se avisa en el arranque que faltan credenciales (detalles
  // pendientes para una proxima pasada). Sin ninguna -> modulo no configurado.
  return { feedbackMissing: missing.length < required.length ? missing : [] };
}

const feedbackState = buildFeedbackConfig(parsed.data);

export const config: AppConfig = {
  discordToken: parsed.data.DISCORD_TOKEN,
  applicationId: parsed.data.DISCORD_APPLICATION_ID,
  guildId: parsed.data.DEVBOT_GUILD_ID,
  allowedUserIds: parsed.data.DEVBOT_ALLOWED_USER_IDS,
  allowedGuildIds: parsed.data.DEVBOT_ALLOWED_GUILD_IDS,
  notificationChannelId: parsed.data.DEVBOT_NOTIFICATION_CHANNEL_ID,
  logLevel: parsed.data.DEVBOT_LOG_LEVEL,
  prettyLogs: parsed.data.DEVBOT_PRETTY_LOGS,
  feedback: feedbackState.feedback,
  feedbackMissing: feedbackState.feedbackMissing,
};
