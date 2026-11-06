/**
 * Dominio del modulo de feedback: bugs y sugerencias reportados desde
 * Discord que se registran como issues en un backlog de GitHub y cuya
 * ficha se mantiene sincronizada en un canal de Discord.
 *
 * Logica pura, sin dependencias externas (regla de diseno: el nucleo no
 * importa discord.js ni clientes HTTP).
 */

export type FeedbackKind = 'bug' | 'suggestion';

export const FEEDBACK_EMOJI: Record<FeedbackKind, string> = {
  bug: '🐛',
  suggestion: '💡',
};

export interface FeedbackReport {
  kind: FeedbackKind;
  title: string;
  description: string;
  /** Snowflake del usuario de Discord que reporto (auditoria, seccion 11.8). */
  reportedById: string;
  reportedByName: string;
}

/** Estado observable de una issue en GitHub. */
export interface IssueSnapshot {
  number: number;
  title: string;
  state: 'open' | 'closed';
  /** `completed`, `not_planned`, `reopened` o null. */
  stateReason: string | null;
  labels: string[];
  url: string;
  updatedAt: string;
  closedAt: string | null;
}

export function snapshotsEqual(a: IssueSnapshot, b: IssueSnapshot): boolean {
  return (
    a.number === b.number &&
    a.title === b.title &&
    a.state === b.state &&
    a.stateReason === b.stateReason &&
    (a.closedAt ?? null) === (b.closedAt ?? null) &&
    [...a.labels].sort().join('|') === [...b.labels].sort().join('|')
  );
}

/** true si el cambio es de estado (abierta/cerrada/reabierta), no solo de contenido. */
export function statusChanged(previous: IssueSnapshot, current: IssueSnapshot): boolean {
  return previous.state !== current.state || previous.stateReason !== current.stateReason;
}

/** Puerto: donde vive el backlog (implementado por GitHub en infraestructura). */
export interface IssueTrackerPort {
  createIssue(report: FeedbackReport): Promise<IssueSnapshot>;
  listIssuesUpdatedSince(since: Date): Promise<IssueSnapshot[]>;
}

/** Puerto: como se muestra el backlog en Discord (adaptador de Discord). */
export interface BacklogNotifierPort {
  /** Publica la ficha de la issue y devuelve el ID del mensaje para poder editarlo. */
  publishIssueCard(report: FeedbackReport, issue: IssueSnapshot): Promise<string>;
  /** Edita la ficha existente del canal para reflejar el estado actual. */
  updateIssueCard(messageId: string, issue: IssueSnapshot): Promise<void>;
  /** Manda un aviso de cambio de estado al canal. */
  notifyStatusChange(issue: IssueSnapshot, previous: IssueSnapshot): Promise<void>;
}

/** Puerto: persistencia del seguimiento entre reinicios. */
export interface FeedbackStorePort {
  list(): Promise<TrackedFeedback[]>;
  upsert(record: TrackedFeedback): Promise<void>;
  getLastPollAt(): Promise<Date | null>;
  setLastPollAt(at: Date): Promise<void>;
}

export interface TrackedFeedback {
  report: FeedbackReport;
  issue: IssueSnapshot;
  /** ID del mensaje de la ficha en Discord; null si la publicacion fallo. */
  discordMessageId: string | null;
}
