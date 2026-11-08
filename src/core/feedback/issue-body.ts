import type { FeedbackReport } from './types.js';

/**
 * Cuerpo estandar de una issue creada desde Discord. Compartido entre la
 * creacion (GitHub tracker) y la actualizacion (PostIngestor) para que el
 * formato sea el mismo en ambos caminos.
 */
export function buildIssueBody(report: FeedbackReport): string {
  const heading = report.kind === 'bug' ? 'Bug report' : 'Suggestion';
  return [
    `### ${heading} (via DevBot)`,
    '',
    report.description,
    '',
    '---',
    `Reportado por: ${report.reportedByName} (\`${report.reportedById}\`)`,
    `Fecha: ${new Date().toISOString()}`,
    '_Creado y sincronizado automaticamente por DevBot desde Discord._',
  ].join('\n');
}
