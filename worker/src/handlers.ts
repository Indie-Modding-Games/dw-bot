import type { Logger } from 'pino';
import { canInteract } from '../../src/application/authorization.js';
import { handleFeedbackReport, handleSyncNow } from '../../src/application/handlers/feedback.js';
import { handleHelp } from '../../src/application/handlers/help.js';
import type { CommandContext } from '../../src/application/handlers/types.js';
import type { FeedbackKind } from '../../src/core/feedback/types.js';
import { csvList, type Env } from './env.js';
import { logger } from './logger.js';
import { buildServices } from './services.js';

/** Payload minimo de una interaccion de Discord (type 2 = comando). */
export interface InteractionPayload {
  type: number;
  data?: {
    name?: string;
    options?: Array<{ name: string; value?: string | number }>;
  };
  member?: { user?: { id?: string; username?: string } };
  user?: { id?: string; username?: string };
  guild_id?: string;
}

interface InteractionResponse {
  type: number;
  data?: Record<string, unknown>;
}

function getStringOption(payload: InteractionPayload, name: string): string {
  const option = (payload.data?.options ?? []).find((item) => item.name === name);
  return typeof option?.value === 'string' ? option.value : '';
}

export async function handleInteraction(
  payload: InteractionPayload,
  env: Env,
): Promise<InteractionResponse> {
  // PING de verificacion: type 1 (documentacion 2026) responder PONG type 1.
  if (payload.type === 1) return { type: 1 };

  if (payload.type !== 2 || !payload.data?.name) {
    return { type: 4, data: { content: 'Nada que hacer aqui.', flags: 64 } };
  }

  const user = payload.member?.user ?? payload.user ?? {};
  const userId = user.id ?? '';
  const userName = user.username ?? 'desconocido';
  const command = payload.data.name;

  // Allowlist (fail-closed), misma logica que la version local.
  const allowed = canInteract(
    { allowedUserIds: csvList(env.DEVBOT_ALLOWED_USER_IDS), allowedGuildIds: [] },
    userId,
    payload.guild_id ?? null,
  );
  if (!allowed) {
    logger.warn(
      { event: 'interaction.denied', userId, command },
      'interaccion rechazada por allowlist',
    );
    return { type: 4, data: { content: 'No tienes permiso para usar este bot.', flags: 64 } };
  }

  logger.info({ event: 'interaction.received', userId, command }, 'slash command invocado');

  let response: InteractionResponse | null = null;
  const ctx: CommandContext = {
    userId,
    userName,
    reply: async (content, options = {}) => {
      if (!response) {
        response = {
          type: 4,
          data: { content, ...(options.ephemeral ? { flags: 64 } : {}) },
        };
      }
    },
  };

  const services = buildServices(env);

  try {
    switch (command) {
      case 'help':
        await handleHelp(ctx);
        break;
      case 'status':
        await handleWorkerStatus(ctx, env, services.store);
        break;
      case 'bug':
      case 'suggest': {
        const kind: FeedbackKind = command === 'bug' ? 'bug' : 'suggestion';
        await handleFeedbackReport(
          ctx,
          kind,
          {
            title: getStringOption(payload, 'title'),
            description: getStringOption(payload, 'description'),
          },
          { service: services.service, logger: logger as Logger },
        );
        break;
      }
      case 'sync-now':
        await handleSyncNow(ctx, {
          service: services.service,
          ingestor: services.ingestor,
          plans: services.plans,
          logger: logger as Logger,
        });
        break;
      default:
        await ctx.reply('Comando no reconocido.', { ephemeral: true });
    }
  } catch (error) {
    logger.error({ err: error, command }, 'error al manejar comando');
    response = {
      type: 4,
      data: { content: 'Ocurrio un error al procesar el comando.', flags: 64 },
    };
  }

  return (
    response ?? {
      type: 4,
      data: { content: 'Comando recibido sin respuesta.', flags: 64 },
    }
  );
}

/** /status adaptado a serverless: no hay gateway uptime; se reporta la ultima sincronia. */
async function handleWorkerStatus(
  ctx: CommandContext,
  env: Env,
  store: ReturnType<typeof buildServices>['store'],
): Promise<void> {
  const lastPoll = await store.getLastPollAt();
  const records = await store.list();
  const pending = records.filter((item) => item.tagSwapPending).length;
  await ctx.reply(
    [
      '⚙️ **Andromon — Cloudflare Workers** (serverless, costo $0)',
      `Backlog GitHub: ${env.DEVBOT_GITHUB_REPO}`,
      `Tickets monitorizados: ${records.length}${pending > 0 ? ` (${pending} etiqueta(s) con reintento pendiente)` : ''}`,
      `Ultima sincronizacion: ${lastPoll ? lastPoll.toISOString() : 'nunca (el cron corre cada 5 min)'}`,
      `Foros: ${env.DEVBOT_FEEDBACK_PROPOSALS_CHANNEL_ID ? 'propuestas ✓ ' : ''}${env.DEVBOT_FEEDBACK_BUGS_CHANNEL_ID ? 'bugs ✓' : ''}`,
    ].join('\n'),
    { ephemeral: true },
  );
}
