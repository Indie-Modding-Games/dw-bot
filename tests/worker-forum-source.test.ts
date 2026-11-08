import { describe, expect, it } from 'vitest';
import { WorkerForumSource } from '../worker/src/forum-source.js';
import type { Env } from '../worker/src/env.js';
import type { RestChannel, RestMessage } from '../worker/src/discord-rest.js';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as never;

const FORUM_ID = 'ch-bugs';
const TAG_ID = 'tag-req';

class FakeRest {
  threads: RestChannel[] = [
    {
      id: 'th-1',
      type: 11,
      name: 'El launcher abre en negro',
      parent_id: FORUM_ID,
      applied_tags: [TAG_ID],
      thread_metadata: { archived: false },
    },
  ];
  /** Mensajes en orden cronologico (como los devuelve DiscordRest.fetchThreadMessages). */
  messages: RestMessage[] = [];
  failRead = false;

  async getChannel(id: string): Promise<RestChannel> {
    if (id === FORUM_ID)
      return { id, type: 15, available_tags: [{ id: TAG_ID, name: 'En revision' }] };
    const t = this.threads.find((thread) => thread.id === id);
    if (!t) throw new Error('unknown channel');
    return t;
  }
  async listActiveThreads(): Promise<RestChannel[]> {
    return this.threads;
  }
  async fetchThreadMessages(_threadId: string, _after: string | null): Promise<RestMessage[]> {
    if (this.failRead) throw new Error('HTTP 429');
    return this.messages;
  }
  async downloadAttachment(): Promise<ArrayBuffer | null> {
    return new ArrayBuffer(4);
  }
}

function msg(overrides: Partial<RestMessage> & { id: string }): RestMessage {
  return {
    content: '',
    author: { id: 'u-op', username: 'berseker39' },
    timestamp: '2026-11-08T19:00:00.000Z',
    ...overrides,
  };
}

function makeSource() {
  const rest = new FakeRest();
  const env = { DEVBOT_GUILD_ID: 'g-1' } as Env;
  const source = new WorkerForumSource(rest as never, env, silentLogger);
  return { rest, source };
}

describe('WorkerForumSource: texto del cuerpo', () => {
  it('usa el mensaje inicial cuando tiene texto', async () => {
    const { rest, source } = makeSource();
    rest.messages = [msg({ id: 'm-1', content: 'Texto real del starter' })];

    const posts = await source.fetchPosts(FORUM_ID, 'En revision');

    expect(posts[0]?.description).toBe('Texto real del starter');
    expect(posts[0]?.starterMessageId).toBe('m-1');
    expect(posts[0]?.watermarkMessageId).toBe('m-1');
  });

  it('con starter vacio toma el PRIMER MENSAJE con texto del OP en el chat del post', async () => {
    const { rest, source } = makeSource();
    rest.messages = [
      msg({ id: 'm-1', content: '' }), // starter sin texto (el caso reportado)
      msg({ id: 'm-2', content: 'yo tambien lo veo', author: { id: 'u-otro', username: 'otro' } }),
      msg({
        id: 'm-3',
        content: 'El launcher abre la ventana en negro al iniciar',
        author: { id: 'u-op', username: 'berseker39' },
      }),
    ];

    const posts = await source.fetchPosts(FORUM_ID, 'En revision');

    expect(posts[0]?.description).toBe('El launcher abre la ventana en negro al iniciar');
    expect(posts[0]?.starterMessageId).toBe('m-1');
    // Marca de agua en m-3: ese mensaje no debe reenviarse como comentario.
    expect(posts[0]?.watermarkMessageId).toBe('m-3');
    // La firma del cuerpo no debe cambiar solo porque otro usuario responda despues.
    rest.messages = [...rest.messages, msg({ id: 'm-4', content: 'fixed?' })];
    const again = await source.fetchPosts(FORUM_ID, 'En revision');
    expect(again[0]?.description).toBe(posts[0]?.description);
  });

  it('el fallback ignora bots y mensajes del sistema', async () => {
    const { rest, source } = makeSource();
    rest.messages = [
      msg({ id: 'm-1', content: '' }),
      msg({
        id: 'm-2',
        content: 'fixeado',
        author: { id: 'u-bot', username: 'Andromon', bot: true },
      }),
      msg({ id: 'm-3', content: 'anadi esto', type: 3 }), // sistema
    ];

    const posts = await source.fetchPosts(FORUM_ID, 'En revision');

    expect(posts[0]?.description).toBe('_(post sin texto)_');
    expect(posts[0]?.watermarkMessageId).toBe('m-1');
  });

  it('si la lectura falla (429), description es null y la issue no se toca', async () => {
    const { rest, source } = makeSource();
    rest.failRead = true;

    const posts = await source.fetchPosts(FORUM_ID, 'En revision');

    expect(posts[0]?.description).toBeNull();
    expect(posts[0]?.messages).toBeNull();
  });
});
