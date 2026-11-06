import type { Logger } from 'pino';
import {
  FEEDBACK_EMOJI,
  type FeedbackKind,
  type FeedbackReport,
} from '../../core/feedback/types.js';
import type { FeedbackService } from '../services/feedback.service.js';
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
