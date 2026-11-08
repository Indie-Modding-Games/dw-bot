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

/** Archivo (captura/video) listo para subir como asset de usuario de GitHub. */
export interface UploadedFile {
  name: string;
  contentType: string;
  bytes: ArrayBuffer;
}

/** Puerto: donde vive el backlog (implementado por GitHub en infraestructura). */
export interface IssueTrackerPort {
  createIssue(report: FeedbackReport): Promise<IssueSnapshot>;
  listIssuesUpdatedSince(since: Date): Promise<IssueSnapshot[]>;
  /** Lectura puntual (reintentos de swaps que cayeron fuera de la ventana `since`). */
  getIssue(number: number): Promise<IssueSnapshot | null>;
  /** Edita titulo y/o cuerpo de una issue existente (post de foro editado). */
  updateIssue(number: number, patch: { title?: string; body?: string }): Promise<IssueSnapshot>;
  /** Publica un comentario en la issue (respuestas del post de foro). */
  addIssueComment(issueNumber: number, body: string): Promise<void>;
  /**
   * Sube un archivo (captura, video) como asset de usuario de GitHub y
   * devuelve la URL markdown-ready (`https://github.com/user-attachments/...`).
   */
  uploadAttachment(attachment: UploadedFile): Promise<string>;
}

/** Plan de ingestion de un canal de foro hacia el backlog. */
export interface PostSyncPlan {
  kind: FeedbackKind;
  channelId: string;
  /** Solo posts con esta etiqueta entran al backlog. */
  requiredTag: string;
  /** Etiqueta a aplicar cuando el ticket llega a done; null = no cambiar nada. */
  doneTag: string | null;
}

/** Puerto: como se muestra el backlog en Discord (adaptador de Discord). */
export interface BacklogNotifierPort {
  /** Publica la ficha de la issue y devuelve el ID del mensaje para poder editarlo. */
  publishIssueCard(report: FeedbackReport, issue: IssueSnapshot): Promise<string>;
  /** Edita la ficha existente del canal para reflejar el estado actual. */
  updateIssueCard(messageId: string, issue: IssueSnapshot): Promise<void>;
  /** Manda un aviso de cambio de estado al canal. */
  notifyStatusChange(issue: IssueSnapshot, previous: IssueSnapshot): Promise<void>;
  /**
   * Cambia la etiqueta del post de foro: quita `requiredTag` y pone `doneTagName`
   * cuando el ticket llega a done, y ARCHIVA (bloquea) el post para que salga
   * del foro activo y de las busquedas sin borrar el historial.
   * Solo aplica a posts monitorizados.
   */
  markPostDone(post: TrackedPostInfo, issue: IssueSnapshot, doneTagName: string): Promise<void>;
}

/** Puerto: persistencia del seguimiento entre reinicios. */
export interface FeedbackStorePort {
  list(): Promise<TrackedFeedback[]>;
  upsert(record: TrackedFeedback): Promise<void>;
  getLastPollAt(): Promise<Date | null>;
  setLastPollAt(at: Date): Promise<void>;
}

/** Info del post de foro de Discord monitorizado (origen del ticket). */
export interface TrackedPostInfo {
  /** Canal de foro padre (GuildForumChannel). */
  channelId: string;
  /** Hilo/post del foro. */
  threadId: string;
  /** Etiqueta que habilita la ingestion (p.ej. "Aceptado"). */
  requiredTag: string;
  /** Etiqueta a aplicar cuando el ticket pasa a done; null = no swap. */
  doneTag: string | null;
  /**
   * Firma del post (titulo + texto + IDs de adjuntos) en la ultima
   * sincronizacion exitosa; cambia cuando el autor edito el post.
   */
  contentHash?: string;
  /** ID del mensaje inicial: marca de agua para no reenviar el historial. */
  starterMessageId?: string | null;
  /** ID del ultimo mensaje del hilo ya reenviado como comentario. */
  lastCommentId?: string | null;
}

/** Archivo adjunto (captura, video...) del mensaje inicial o de una respuesta. */
export interface PostAttachment {
  id: string;
  filename: string;
  /** URL del CDN de Discord (origen de la descarga). */
  url: string;
  contentType?: string | null;
  size?: number;
}

/** Respuesta dentro del post de foro (hilo), para reenviar como comentario. */
export interface ForumThreadMessage {
  id: string;
  content: string;
  authorName: string;
  /** Snowflake del autor (para emparejar mensajes del OP). */
  authorId: string | null;
  /** ISO del mensaje. */
  createdAt: string;
  isBot: boolean;
  /** Tipo de mensaje de Discord; 0 = regular (el resto son del sistema). */
  type: number;
  attachments: PostAttachment[];
}

/** Post de un canal de foro de Discord, leido por el adaptador. */
export interface ForumPost {
  channelId: string;
  threadId: string;
  title: string;
  /** Contenido del mensaje inicial; null si NO se pudo leer este ciclo. */
  description: string | null;
  authorName: string;
  /** URL para enlazar el post desde la issue. */
  postUrl: string;
  /** Adjuntos del mensaje inicial (capturas subidas por el autor). */
  attachments: PostAttachment[];
  /** ID del mensaje inicial; null si no se pudo leer el post. */
  starterMessageId: string | null;
  /**
   * ID del ultimo mensaje consumido para armar la descripcion (el starter o,
   * si estaba vacio, el primer mensaje con texto del OP en el chat del hilo).
   * Marca de agua inicial: ese mensaje no debe reenviarse como comentario.
   */
  watermarkMessageId: string | null;
  /**
   * Ultimos mensajes del hilo leidos en la MISMA pasada que el post, en orden
   * cronologico (null si fallo la lectura). El ingestor saca de aqui las
   * respuestas nuevas: una sola lectura de Discord por post y ciclo.
   */
  messages: ForumThreadMessage[] | null;
}

/** Bytes descargados de un adjunto de Discord. */
export interface UploadedFile {
  name: string;
  contentType: string;
  bytes: ArrayBuffer;
}

/** Puerto: lee posts etiquetados de un canal de foro (adaptador Discord). */
export interface ForumPostSourcePort {
  fetchPosts(channelId: string, requiredTag: string): Promise<ForumPost[]>;
  /** Descarga un adjunto del CDN de Discord; null si ya no existe o fallo. */
  fetchAttachmentBytes(url: string): Promise<ArrayBuffer | null>;
}

/** true si el ticket esta cerrado y NO como "no prevista" => done. */
export function isDoneIssue(issue: IssueSnapshot): boolean {
  return issue.state === 'closed' && issue.stateReason !== 'not_planned';
}

export interface TrackedFeedback {
  report: FeedbackReport;
  issue: IssueSnapshot;
  /** ID del mensaje de la ficha en Discord; null si la publicacion fallo. */
  discordMessageId: string | null;
  /** Set cuando el ticket nacio de un post de foro (ingestion automatica). */
  post?: TrackedPostInfo;
  /** El swap de etiqueta del post fallo y debe reintentarse en proximos ticks. */
  tagSwapPending?: boolean;
  /**
   * Adjuntos del post ya procesados: ID de adjunto -> URL de asset en GitHub
   * (o `skipped` si se descarto a proposito). Evita subir la misma captura dos veces.
   */
  uploadedAttachments?: Record<string, string>;
}
