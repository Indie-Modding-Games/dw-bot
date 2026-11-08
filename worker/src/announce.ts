import type { D1Database } from '@cloudflare/workers-types';
import type { Logger } from 'pino';
import type { Env } from './env.js';
import type { DiscordRest } from './discord-rest.js';
import { buildAnnouncement, DEVBOT_RELEASE } from './release-notes.js';

const META_KEY = 'announcedRelease';

interface AnnounceDeps {
  db: D1Database;
  rest: DiscordRest;
  channelId: string;
  logger: Logger;
}

/**
 * Anuncia en Discord la version actual del worker si aun no fue anunciada
 * (comparacion con una marca en D1). Idempotente y barato: 1 lectura D1 por
 * evento; puede llamarse en cada tick del cron. Se desactiva con
 * `DEVBOT_ANNOUNCE_ON_UPDATE=0`.
 *
 * La marca se guarda SOLO tras enviar el mensaje: si Discord falla, el
 * proximo evento reintenta. Si el guardado falla tras enviar, puede
 * duplicarse un aviso (riesgo menor aceptado).
 */
export async function maybeAnnounceUpdate(env: Env, deps: AnnounceDeps): Promise<void> {
  if ((env.DEVBOT_ANNOUNCE_ON_UPDATE ?? '1') !== '1') return;

  const row = await deps.db
    .prepare('SELECT value FROM meta WHERE key = ?1')
    .bind(META_KEY)
    .first<{ value: string }>();
  if (row?.value === DEVBOT_RELEASE) return;

  try {
    await deps.rest.sendText(deps.channelId, buildAnnouncement(DEVBOT_RELEASE));
  } catch (error) {
    deps.logger.warn(
      { err: error, event: 'worker.announce_failed', release: DEVBOT_RELEASE },
      'no se pudo anunciar la actualizacion en Discord; se reintentara en el proximo evento',
    );
    return;
  }

  await deps.db
    .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)')
    .bind(META_KEY, DEVBOT_RELEASE)
    .run();
  deps.logger.info(
    { event: 'worker.announced', release: DEVBOT_RELEASE },
    'nueva version anunciada en el canal de backlog',
  );
}
