import type { Logger } from 'pino';
import {
  FEEDBACK_EMOJI,
  type FeedbackKind,
  type FeedbackReport,
  type PostSyncPlan,
} from '../../core/feedback/types.js';
import type { FeedbackService } from '../services/feedback.service.js';
import type { PostIngestor } from '../services/post-ingestor.js';
import type { CommandContext } from './types.js';

export interface FeedbackHandlerDeps {
  /** null cuando el modulo no esta configurado (faltan credenciales en .env). */
  service: FeedbackService | null;
  logger: Logger;
}

/**
 * `/bug` y `/suggest`: registran el reporte como issue en el backlog de
 * GitHub. Los textos del usuario van al cuerpo de la issue como datos,
 * nunca como comandos (seccion 11, punto 4: tareas declarativas).
 */
export async function handleFeedbackReport(
  ctx: CommandContext,
  kind: FeedbackKind,
  input: { title: string; description: string },
  deps: FeedbackHandlerDeps,
): Promise<void> {
  if (!deps.service) {
    await ctx.reply(
      [
        '⚠️ El reporte a GitHub no esta habilitado (configuracion pendiente).',
        'Falta definir en `.env`: `DEVBOT_GITHUB_TOKEN`, `DEVBOT_GITHUB_REPO` y `DEVBOT_FEEDBACK_CHANNEL_ID`.',
      ].join('\n'),
      { ephemeral: true },
    );
    return;
  }

  const report: FeedbackReport = {
    kind,
    title: input.title,
    description: input.description,
    reportedById: ctx.userId,
    reportedByName: ctx.userName,
  };

  let issueNumber: number;
  let issueUrl: string;
  try {
    const created = await deps.service.submitReport(report);
    issueNumber = created.issue.number;
    issueUrl = created.issue.url;
  } catch (error) {
    deps.logger.error(
      { err: error, event: 'feedback.submit_failed', kind },
      'no se pudo crear la issue en GitHub',
    );
    await ctx.reply(
      '❌ No se pudo registrar en GitHub. Revisa la configuracion del backlog en `.env` (token, repo).',
      { ephemeral: true },
    );
    return;
  }

  const label = kind === 'bug' ? 'bug' : 'sugerencia';
  await ctx.reply(
    [
      `${FEEDBACK_EMOJI[kind]} ${label} registrado en el backlog: **issue #${issueNumber}**`,
      issueUrl,
      '',
      'La ficha se publico en el canal de backlog y el bot la actualiza automaticamente cuando cambie su estado.',
    ].join('\n'),
    { ephemeral: true },
  );
}

export interface SyncNowDeps {
  service: FeedbackService | null;
  ingestor: PostIngestor | null;
  plans: PostSyncPlan[];
  logger: Logger;
}

/**
 * `/sync-now`: dispara de inmediato el ciclo completo (ingestion de posts
 * etiquetados de los foros + sincronizacion de estados GitHub → Discord),
 * sin esperar al cron.
 */
export async function handleSyncNow(ctx: CommandContext, deps: SyncNowDeps): Promise<void> {
  if (!deps.service) {
    await ctx.reply(
      '⚠️ El modulo de feedback no esta habilitado (faltan credenciales de GitHub en `.env`).',
      { ephemeral: true },
    );
    return;
  }

  try {
    const ingestion =
      deps.ingestor && deps.plans.length > 0
        ? await deps.ingestor.ingestNewPosts(deps.plans)
        : { scanned: 0, created: 0 };
    const sync = await deps.service.syncUpdatedIssues();

    await ctx.reply(
      [
        '🔄 **Ciclo de sincronizacion completado**',
        `Foros: posts revisados ${ingestion.scanned} · tickets nuevos ${ingestion.created}`,
        `GitHub → Discord: fichas actualizadas ${sync.cardUpdates} · avisos de estado ${sync.stateChanges} · etiquetas cambiadas ${sync.tagSwaps}`,
      ].join('\n'),
      { ephemeral: true },
    );
  } catch (error) {
    deps.logger.error(
      { err: error, event: 'sync_now.failed' },
      'fallo el ciclo manual de sincronizacion',
    );
    await ctx.reply('❌ El ciclo de sincronizacion fallo. Revisa los logs del bot.', {
      ephemeral: true,
    });
  }
}
