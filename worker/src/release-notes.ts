/**
 * Version del worker y notas de cada release. Al subir una mejora visible,
 * bump `DEVBOT_RELEASE` y anade sus notas aqui: Andromon anuncia la
 * actualizacion en el canal de backlog cuando detecta una version nueva.
 * (Formato AAAA.MM.DD.n — n increments el mismo dia.)
 */
export const DEVBOT_RELEASE = '2026.11.08.2';

export const RELEASE_NOTES: Record<string, string[]> = {
  '2026.11.08.1': [
    'Sincronizacion continua: si editas un post del foro, la issue se actualiza sola',
    'Las capturas/videos del post se suben a GitHub y se ven dentro de la issue',
    'Las respuestas del post se reenvian como comentarios de la issue',
    'Cuando el ticket llega a done, el post se etiqueta y se archiva (fuera de busquedas)',
    'Este mensaje: aviso automatico al quedarse actualizado (desactivable con DEVBOT_ANNOUNCE_ON_UPDATE=0)',
  ],
  '2026.11.08.2': [
    'Ya no quedan issues "sin texto": si un ciclo no puede leer el post, la issue NO se toca y el siguiente ciclo la repara con el primer mensaje actual del OP',
    'Los tickets de posts viejos (Aceptado / En revision) se refrescan solos con el contenido actual del primer mensaje',
    'Mitad de llamadas a Discord por ciclo: una sola lectura por post cubre mensaje inicial y respuestas',
    'Reintento automatico cuando Discord aplica rate-limit (HTTP 429 con Retry-After)',
  ],
};

/** Mensaje de anuncio para la version actual (con notas o fallback generico). */
export function buildAnnouncement(release: string): string {
  const notes = RELEASE_NOTES[release] ?? ['Mejoras internas varias (sin notas publicadas).'];
  return [
    `🔧 **Andromon actualizado a \`${release}\`**`,
    '',
    '_Estas son mis mejoras:_',
    ...notes.map((note) => `- ${note}`),
  ].join('\n');
}
