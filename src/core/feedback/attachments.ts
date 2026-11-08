import type { ForumPost, ForumThreadMessage, PostAttachment } from './types.js';

/** Tamano maximo por archivo a subir a GitHub (los adjuntos grandes no se reintentan). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Maximo de subidas por sincronizacion de un post (el resto queda para el proximo tick). */
export const MAX_UPLOADS_PER_SYNC = 8;

/** Maximo de respuestas reenviadas como comentarios por ciclo. */
export const MAX_COMMENTS_PER_SYNC = 20;

/** Limite del cuerpo de un comentario de GitHub (API: 65536; margen). */
const MAX_COMMENT_BODY = 60000;

/** Limite del texto del post dentro del cuerpo de la issue (margen para el footer del tracker). */
const MAX_ISSUE_DESCRIPTION = 50000;

/** Marcador de adjunto descartado a proposito (tamano/tipo/URL muerta): no se reintenta. */
export const SKIPPED_ATTACHMENT = 'skipped';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov']);

const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/** MIME apto para el upload de GitHub; null si la extension no es imagen/video soportado. */
export function contentTypeForAttachment(attachment: PostAttachment): string | null {
  const ext = extensionOf(attachment.filename);
  if (!IMAGE_EXTENSIONS.has(ext) && !VIDEO_EXTENSIONS.has(ext)) return null;
  const declared = ((attachment.contentType ?? '').split(';')[0] ?? '').trim().toLowerCase();
  if (declared.startsWith('image/') || declared.startsWith('video/')) return declared;
  return EXTENSION_MIME[ext] ?? null;
}

/** true si va embebida como imagen (`![...]`); los videos se enlazan como URL suelta. */
export function isImageAttachment(attachment: PostAttachment, contentType: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(attachment.filename)) || contentType.startsWith('image/');
}

function hashString(input: string): string {
  // Dos cadenas FNV-1a de 32 bits combinadas: suficiente para detectar edicion de posts.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/**
 * Firma del contenido del post (titulo, texto y adjuntos del mensaje inicial).
 * Cambia solo si el autor edito el post o anadio/quito capturas; las subidas
 * ya hechas a GitHub no la afectan, para evitar bucles de actualizacion.
 */
export function postSignature(post: ForumPost): string {
  const attachmentIds = post.attachments.map((a) => a.id).join(',');
  return hashString(`${post.title}\n${post.description ?? ''}\n${attachmentIds}`);
}

/** true si el id de adjunto fue procesado (subido o descartado a proposito). */
export function isAttachmentHandled(uploaded: Record<string, string>, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(uploaded, id);
}

function renderAttachmentsBlock(
  attachments: PostAttachment[],
  uploaded: Record<string, string>,
): string[] {
  const lines: string[] = [];
  const unavailable: string[] = [];
  for (const attachment of attachments) {
    const url = uploaded[attachment.id];
    if (!url || url === SKIPPED_ATTACHMENT) {
      unavailable.push(attachment.filename);
      continue;
    }
    const contentType = contentTypeForAttachment(attachment) ?? 'image/png';
    lines.push(
      isImageAttachment(attachment, contentType)
        ? `![${attachment.filename}](${url})`
        : `[${attachment.filename}](${url})`,
    );
  }
  if (unavailable.length > 0) {
    lines.push(
      `_Adjuntos no disponibles aqui (tamano/tipo no soportado): ${unavailable
        .map((name) => `\`${name}\``)
        .join(', ')} — ver el post original._`,
    );
  }
  return lines;
}

/**
 * Descripcion del issue (report.description) compuesta desde el post:
 * texto + enlace al post original + capturas ya subidas a GitHub.
 */
export function composePostDescription(post: ForumPost, uploaded: Record<string, string>): string {
  const base = (post.description ?? '_(post sin texto)_').slice(0, MAX_ISSUE_DESCRIPTION);
  const parts = [base, '', `[Ver post original en Discord](${post.postUrl})`];
  if (post.attachments.length > 0) {
    parts.push('', '### Capturas', '', ...renderAttachmentsBlock(post.attachments, uploaded));
  }
  return parts.join('\n');
}

/** Cuerpo del comentario de GitHub para una respuesta del post de foro. */
export function buildCommentBody(
  message: ForumThreadMessage,
  uploaded: Record<string, string>,
): string {
  const parts = [
    `*${message.authorName}* — ${message.createdAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`,
    '',
    message.content.slice(0, MAX_COMMENT_BODY - 1000) || '_(sin texto)_',
  ];
  if (message.attachments.length > 0) {
    parts.push('', ...renderAttachmentsBlock(message.attachments, uploaded));
  }
  return parts.join('\n').slice(0, MAX_COMMENT_BODY);
}
