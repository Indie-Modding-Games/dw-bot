import { describe, expect, it } from 'vitest';
import { maybeAnnounceUpdate } from '../worker/src/announce.js';
import { DEVBOT_RELEASE } from '../worker/src/release-notes.js';
import type { Env } from '../worker/src/env.js';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as never;

/** D1 minimo: tabla meta (key,value) para SELECT/INSERT OR REPLACE. */
class FakeD1 {
  meta = new Map<string, string>();

  prepare(sql: string) {
    const meta = this.meta;
    return {
      bind(key: string, value?: string) {
        return {
          async first() {
            if (!sql.includes('SELECT')) return null;
            const stored = meta.get(key);
            return stored === undefined ? null : { value: stored };
          },
          async run() {
            if (sql.includes('REPLACE') && value !== undefined) meta.set(key, value);
            return {};
          },
        };
      },
    };
  }
}

class FakeRest {
  sent: string[] = [];
  fail = false;
  async sendText(_channelId: string, content: string) {
    if (this.fail) throw new Error('Discord API fallo: HTTP 401');
    this.sent.push(content);
    return { id: 'msg-1' };
  }
}

function makeDeps() {
  const db = new FakeD1();
  const rest = new FakeRest();
  const env = { DEVBOT_ANNOUNCE_ON_UPDATE: '1' } as Env;
  const deps = {
    db: db as never,
    rest: rest as never,
    channelId: 'ch-backlog',
    logger: silentLogger,
  };
  return { db, rest, env, deps };
}

describe('maybeAnnounceUpdate', () => {
  it('anuncia la version nueva una sola vez (marca en D1)', async () => {
    const { db, rest, env, deps } = makeDeps();

    await maybeAnnounceUpdate(env, deps);
    expect(rest.sent).toHaveLength(1);
    expect(rest.sent[0]).toContain(DEVBOT_RELEASE);
    expect(rest.sent[0]).toContain('Estas son mis mejoras');
    expect(db.meta.get('announcedRelease')).toBe(DEVBOT_RELEASE);

    // Eventos siguientes (cron/interacciones): no vuelve a anunciar.
    await maybeAnnounceUpdate(env, deps);
    await maybeAnnounceUpdate(env, deps);
    expect(rest.sent).toHaveLength(1);
  });

  it('no anuncia nada si la opcion esta apagada', async () => {
    const { rest, env, deps } = makeDeps();
    env.DEVBOT_ANNOUNCE_ON_UPDATE = '0';

    await maybeAnnounceUpdate(env, deps);

    expect(rest.sent).toHaveLength(0);
  });

  it('si Discord falla, no marca nada y reintenta en el proximo evento', async () => {
    const { db, rest, env, deps } = makeDeps();
    rest.fail = true;

    await maybeAnnounceUpdate(env, deps);
    expect(rest.sent).toHaveLength(0);
    expect(db.meta.get('announcedRelease')).toBeUndefined();

    rest.fail = false;
    await maybeAnnounceUpdate(env, deps);
    expect(rest.sent).toHaveLength(1);
    expect(db.meta.get('announcedRelease')).toBe(DEVBOT_RELEASE);
  });
});
